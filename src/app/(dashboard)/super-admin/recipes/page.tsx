'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../super-admin.module.css';

type Brand = { id: string; name: string };
type Item = { id: string; name: string; uom: string };

type RecipeIngredient = {
  id?: string;
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

    if (rData) setRecipes(rData as any);
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
          <p className={styles.subtitle}>Define exact ingredient consumption per POS product for accurate stock variance tracking</p>
        </div>
        <button className={styles.primaryButton} onClick={() => setIsAdding(!isAdding)}>
          {isAdding ? 'Cancel' : '+ Add New Recipe'}
        </button>
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
                placeholder="Qty"
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
              + Add Ingredient
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        {recipe.recipe_ingredients?.length || 0} ingredients
                      </span>
                      <button className={styles.secondaryButton}>
                        {isExpanded ? 'Collapse ▲' : 'View Ingredients ▼'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Raw Material / Ingredient</th>
                            <th>Consumption Quantity</th>
                            <th>Unit (UOM)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recipe.recipe_ingredients && recipe.recipe_ingredients.length > 0 ? (
                            recipe.recipe_ingredients.map((ing, idx) => (
                              <tr key={idx}>
                                <td>{ing.items?.name || 'Unknown Item'}</td>
                                <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{ing.quantity}</td>
                                <td>{ing.items?.uom || 'grams'}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                                No ingredients added to this recipe yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
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
