'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../super-admin.module.css';

type Brand = { id: string; name: string };
type Item = { id: string; name: string; uom: string };

type RecipeIngredient = {
  id: string;
  recipe_id: string;
  item_id: string;
  quantity: number;
  items?: { name: string; uom: string };
};

type Recipe = {
  id: string;
  brand_id: string;
  product_name: string;
  product_category: string;
  recipe_ingredients: RecipeIngredient[];
  brands?: { name: string };
};

export default function RecipesPage() {
  const supabase = createClient();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New recipe form modal
  const [isAdding, setIsAdding] = useState(false);
  const [newRecipe, setNewRecipe] = useState({
    product_name: '',
    brand_id: '',
    product_category: 'Holland Pancakes',
  });
  const [newIngredients, setNewIngredients] = useState<{ item_id: string; quantity: number }[]>([
    { item_id: '', quantity: 0 },
  ]);

  // Ingredient Add form for an expanded recipe
  const [addIngredientMap, setAddIngredientMap] = useState<Record<string, { item_id: string; quantity: number }>>({});

  // Editing state for ingredient quantities per recipe
  const [editingQuantities, setEditingQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data: bData } = await supabase.from('brands').select('*');
    if (bData) {
      setBrands(bData);
      if (bData.length > 0 && !newRecipe.brand_id) {
        setNewRecipe(prev => ({ ...prev, brand_id: bData[0].id }));
      }
    }

    const { data: iData } = await supabase.from('items').select('id, name, uom').order('name');
    if (iData) {
      setItems(iData);
      if (iData.length > 0 && newIngredients[0].item_id === '') {
        setNewIngredients([{ item_id: iData[0].id, quantity: 0 }]);
      }
    }

    const { data: rData } = await supabase
      .from('recipes')
      .select('*, brands(name), recipe_ingredients(*, items(name, uom))')
      .order('product_name');

    if (rData) {
      setRecipes(rData as any);
      // Initialize edit state map for quantities
      const qMap: Record<string, number> = {};
      (rData as any).forEach((r: Recipe) => {
        r.recipe_ingredients?.forEach(ing => {
          qMap[ing.id] = ing.quantity;
        });
      });
      setEditingQuantities(qMap);
    }
    setLoading(false);
  }

  function handleAddIngredientRow() {
    const defaultItemId = items[0]?.id || '';
    setNewIngredients([...newIngredients, { item_id: defaultItemId, quantity: 0 }]);
  }

  function handleRemoveIngredientRow(index: number) {
    setNewIngredients(newIngredients.filter((_, i) => i !== index));
  }

  async function handleCreateRecipe(e: React.FormEvent) {
    e.preventDefault();
    if (!newRecipe.product_name || !newRecipe.brand_id) return;

    // 1. Insert recipe
    const { data: recipeData, error: recipeErr } = await supabase
      .from('recipes')
      .insert({
        product_name: newRecipe.product_name,
        brand_id: newRecipe.brand_id,
        product_category: newRecipe.product_category,
      })
      .select()
      .single();

    if (recipeErr || !recipeData) {
      alert('Error creating recipe: ' + recipeErr?.message);
      return;
    }

    // 2. Insert ingredients
    const validIngredients = newIngredients.filter(i => i.item_id && i.quantity > 0);
    if (validIngredients.length > 0) {
      const ingRows = validIngredients.map(i => ({
        recipe_id: recipeData.id,
        item_id: i.item_id,
        quantity: i.quantity,
      }));
      await supabase.from('recipe_ingredients').insert(ingRows);
    }

    setIsAdding(false);
    setNewRecipe({ product_name: '', brand_id: brands[0]?.id || '', product_category: 'Holland Pancakes' });
    setNewIngredients([{ item_id: items[0]?.id || '', quantity: 0 }]);
    fetchData();
  }

  async function handleSaveIngredientQuantity(ingredientId: string) {
    const newQty = editingQuantities[ingredientId];
    if (newQty === undefined || newQty < 0) return;

    const { error } = await supabase
      .from('recipe_ingredients')
      .update({ quantity: newQty })
      .eq('id', ingredientId);

    if (!error) {
      fetchData();
    } else {
      alert('Error updating ingredient grammage: ' + error.message);
    }
  }

  async function handleAddSingleIngredient(recipeId: string) {
    const ingData = addIngredientMap[recipeId];
    if (!ingData || !ingData.item_id || ingData.quantity <= 0) {
      alert('Please select an item and enter a valid quantity');
      return;
    }

    const { error } = await supabase.from('recipe_ingredients').insert({
      recipe_id: recipeId,
      item_id: ingData.item_id,
      quantity: ingData.quantity,
    });

    if (!error) {
      setAddIngredientMap(prev => ({ ...prev, [recipeId]: { item_id: items[0]?.id || '', quantity: 0 } }));
      fetchData();
    } else {
      alert('Error adding ingredient: ' + error.message);
    }
  }

  async function handleDeleteIngredient(ingredientId: string) {
    if (!confirm('Remove this ingredient from the recipe?')) return;
    const { error } = await supabase.from('recipe_ingredients').delete().eq('id', ingredientId);
    if (!error) fetchData();
  }

  async function handleDeleteRecipe(recipeId: string, productName: string) {
    if (!confirm(`Are you sure you want to delete recipe "${productName}"?`)) return;
    const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
    if (!error) fetchData();
  }

  const filteredRecipes = recipes.filter(r => {
    const matchesSearch = r.product_name.toLowerCase().includes(search.toLowerCase());
    const matchesBrand = selectedBrand === 'all' || r.brand_id === selectedBrand;
    return matchesSearch && matchesBrand;
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Recipe & Bill of Materials (BOM) Builder</h1>
          <p className={styles.subtitle}>Define, edit, and manage exact raw material grammage per POS item for accurate stock variance audits</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <a href="/super-admin/items" className={styles.secondaryButton} style={{ textDecoration: 'none' }}>
            📦 Item Catalog
          </a>
          <button className={styles.primaryButton} onClick={() => setIsAdding(!isAdding)}>
            {isAdding ? 'Cancel' : '+ Add New Recipe'}
          </button>
        </div>
      </div>

      {isAdding && (
        <form className={styles.card} onSubmit={handleCreateRecipe} style={{ marginBottom: '1.5rem' }}>
          <h3>Add New POS Product Recipe</h3>
          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label>Product Name (exact POS item name)</label>
              <input
                type="text"
                required
                value={newRecipe.product_name}
                onChange={e => setNewRecipe({ ...newRecipe, product_name: e.target.value })}
                placeholder="e.g. Holla Nutella 12pc"
              />
            </div>

            <div className={styles.fieldGroup}>
              <label>Brand</label>
              <select
                value={newRecipe.brand_id}
                onChange={e => setNewRecipe({ ...newRecipe, brand_id: e.target.value })}
              >
                {brands.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label>Product Category</label>
              <input
                type="text"
                value={newRecipe.product_category}
                onChange={e => setNewRecipe({ ...newRecipe, product_category: e.target.value })}
                placeholder="e.g. Holland Pancakes, Waffles, Crepes"
              />
            </div>
          </div>

          <h4 style={{ margin: '1rem 0 0.5rem 0', color: 'var(--accent-primary)' }}>Ingredients (Bill of Materials)</h4>
          {newIngredients.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', alignItems: 'center' }}>
              <select
                style={{ flex: 2 }}
                value={row.item_id}
                onChange={e => {
                  const updated = [...newIngredients];
                  updated[idx].item_id = e.target.value;
                  setNewIngredients(updated);
                }}
              >
                {items.map(i => (
                  <option key={i.id} value={i.id}>{i.name} ({i.uom})</option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                placeholder="Qty (g / ml / pcs)"
                style={{ flex: 1 }}
                value={row.quantity || ''}
                onChange={e => {
                  const updated = [...newIngredients];
                  updated[idx].quantity = parseFloat(e.target.value) || 0;
                  setNewIngredients(updated);
                }}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => handleRemoveIngredientRow(idx)}
              >
                Remove
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button type="button" className={styles.secondaryButton} onClick={handleAddIngredientRow}>
              + Add Ingredient Row
            </button>
            <button type="submit" className={styles.primaryButton}>
              Save Recipe
            </button>
          </div>
        </form>
      )}

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <input
          type="text"
          placeholder="Search recipes by product name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={styles.searchInput}
        />
        <select
          value={selectedBrand}
          onChange={e => setSelectedBrand(e.target.value)}
          className={styles.selectFilter}
        >
          <option value="all">All Brands</option>
          {brands.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {/* Recipe list / accordions */}
      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Loading recipe database...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredRecipes.length === 0 ? (
            <div className={styles.card} style={{ textAlign: 'center', padding: '2rem' }}>
              No recipes found. Click "+ Add New Recipe" to create your first recipe.
            </div>
          ) : (
            filteredRecipes.map(recipe => {
              const isExpanded = expandedId === recipe.id;
              const addState = addIngredientMap[recipe.id] || { item_id: items[0]?.id || '', quantity: 0 };

              return (
                <div key={recipe.id} className={styles.card}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => setExpandedId(isExpanded ? null : recipe.id)}
                  >
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{recipe.product_name}</h3>
                      <span className={styles.badgeDefault} style={{ marginTop: '0.25rem', display: 'inline-block' }}>
                        {recipe.brands?.name || 'Brand'} &bull; {recipe.product_category || 'General'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        {recipe.recipe_ingredients?.length || 0} ingredients
                      </span>
                      <button
                        className={styles.secondaryButton}
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteRecipe(recipe.id, recipe.product_name);
                        }}
                        style={{ color: 'var(--danger)' }}
                      >
                        Delete
                      </button>
                      <button className={styles.secondaryButton}>
                        {isExpanded ? 'Collapse ▲' : 'Edit Grammage / BOM ▼'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Raw Material / Ingredient</th>
                            <th style={{ width: '180px' }}>Consumption Quantity</th>
                            <th>Unit (UOM)</th>
                            <th style={{ width: '150px' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recipe.recipe_ingredients && recipe.recipe_ingredients.length > 0 ? (
                            recipe.recipe_ingredients.map(ing => (
                              <tr key={ing.id}>
                                <td style={{ fontWeight: 600 }}>{ing.items?.name || 'Unknown Item'}</td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={editingQuantities[ing.id] ?? ing.quantity}
                                    onChange={e => {
                                      const val = parseFloat(e.target.value) || 0;
                                      setEditingQuantities(prev => ({ ...prev, [ing.id]: val }));
                                    }}
                                    style={{
                                      width: '100px',
                                      padding: '0.4rem 0.6rem',
                                      borderRadius: '6px',
                                      background: 'var(--bg-secondary)',
                                      border: '1px solid var(--border-color)',
                                      color: 'var(--accent-primary)',
                                      fontWeight: 700,
                                    }}
                                  />
                                </td>
                                <td>{ing.items?.uom || 'grams'}</td>
                                <td>
                                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <button
                                      className={styles.secondaryButton}
                                      onClick={() => handleSaveIngredientQuantity(ing.id)}
                                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                    >
                                      Save Qty
                                    </button>
                                    <button
                                      className={styles.secondaryButton}
                                      onClick={() => handleDeleteIngredient(ing.id)}
                                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--danger)' }}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                                No ingredients added to this recipe yet. Use the section below to add ingredients.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>

                      {/* Add new ingredient to existing recipe */}
                      <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                          + Add Raw Material Ingredient to {recipe.product_name}
                        </h4>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            style={{
                              flex: 2,
                              minWidth: '200px',
                              padding: '0.5rem',
                              borderRadius: '6px',
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-primary)',
                            }}
                            value={addState.item_id}
                            onChange={e =>
                              setAddIngredientMap(prev => ({
                                ...prev,
                                [recipe.id]: { ...addState, item_id: e.target.value },
                              }))
                            }
                          >
                            {items.map(i => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.uom})
                              </option>
                            ))}
                          </select>

                          <input
                            type="number"
                            step="0.1"
                            placeholder="Qty (g/ml/pcs)"
                            style={{
                              flex: 1,
                              minWidth: '120px',
                              padding: '0.5rem',
                              borderRadius: '6px',
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-primary)',
                            }}
                            value={addState.quantity || ''}
                            onChange={e =>
                              setAddIngredientMap(prev => ({
                                ...prev,
                                [recipe.id]: { ...addState, quantity: parseFloat(e.target.value) || 0 },
                              }))
                            }
                          />

                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => handleAddSingleIngredient(recipe.id)}
                            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                          >
                            Add to Recipe
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
