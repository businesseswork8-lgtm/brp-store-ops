'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../super-admin.module.css';

type Category = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  name: string;
  category_id: string;
  uom: 'grams' | 'ml' | 'pieces';
  purchase_unit_name: string;
  purchase_unit_qty: number;
  is_daily_tracked: boolean;
  is_active: boolean;
  item_categories?: { name: string };
};

export default function ItemsPage() {
  const supabase = createClient();

  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isAdding, setIsAdding] = useState(false);

  // New item form state
  const [newItem, setNewItem] = useState({
    name: '',
    category_id: '',
    uom: 'grams',
    purchase_unit_name: 'Kg',
    purchase_unit_qty: 1,
    is_daily_tracked: true,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Item>>({});

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data: catData } = await supabase.from('item_categories').select('*').order('sort_order');
    if (catData) setCategories(catData);

    const { data: itemData } = await supabase
      .from('items')
      .select('*, item_categories(name)')
      .order('name');
    if (itemData) setItems(itemData);
    setLoading(false);
  }

  async function handleCreateItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.name || !newItem.category_id) return;

    const { error } = await supabase.from('items').insert({
      name: newItem.name,
      category_id: newItem.category_id,
      uom: newItem.uom,
      purchase_unit_name: newItem.purchase_unit_name,
      purchase_unit_qty: newItem.purchase_unit_qty,
      is_daily_tracked: newItem.is_daily_tracked,
      is_active: true,
    });

    if (!error) {
      setIsAdding(false);
      setNewItem({
        name: '',
        category_id: categories[0]?.id || '',
        uom: 'grams',
        purchase_unit_name: 'Kg',
        purchase_unit_qty: 1,
        is_daily_tracked: true,
      });
      fetchData();
    } else {
      alert('Error creating item: ' + error.message);
    }
  }

  async function handleToggleActive(item: Item) {
    const { error } = await supabase
      .from('items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id);

    if (!error) fetchData();
  }

  async function handleSaveEdit(id: string) {
    const { error } = await supabase
      .from('items')
      .update({
        name: editForm.name,
        category_id: editForm.category_id,
        uom: editForm.uom,
        is_daily_tracked: editForm.is_daily_tracked,
      })
      .eq('id', id);

    if (!error) {
      setEditingId(null);
      fetchData();
    }
  }

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category_id === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Item Master Catalog</h1>
          <p className={styles.subtitle}>Manage raw materials, ingredients, and tracked inventory items across stores</p>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => {
            setIsAdding(!isAdding);
            if (!newItem.category_id && categories.length > 0) {
              setNewItem(prev => ({ ...prev, category_id: categories[0].id }));
            }
          }}
        >
          {isAdding ? 'Cancel' : '+ Add New Item'}
        </button>
      </div>

      {isAdding && (
        <form className={styles.card} onSubmit={handleCreateItem} style={{ marginBottom: '1.5rem' }}>
          <h3>Add New Inventory Item</h3>
          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label>Item Name</label>
              <input
                type="text"
                required
                value={newItem.name}
                onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                placeholder="e.g. Dark Chocolate Filling"
              />
            </div>

            <div className={styles.fieldGroup}>
              <label>Category</label>
              <select
                value={newItem.category_id}
                onChange={e => setNewItem({ ...newItem, category_id: e.target.value })}
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label>Unit of Measure (UOM)</label>
              <select
                value={newItem.uom}
                onChange={e => setNewItem({ ...newItem, uom: e.target.value as any })}
              >
                <option value="grams">grams (g)</option>
                <option value="ml">ml</option>
                <option value="pieces">pieces (pcs)</option>
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label>Purchase Unit</label>
              <input
                type="text"
                value={newItem.purchase_unit_name}
                onChange={e => setNewItem({ ...newItem, purchase_unit_name: e.target.value })}
                placeholder="e.g. Kg, Packet, Bottle"
              />
            </div>

            <div className={styles.fieldGroup} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.5rem' }}>
              <input
                type="checkbox"
                id="daily_tracked"
                checked={newItem.is_daily_tracked}
                onChange={e => setNewItem({ ...newItem, is_daily_tracked: e.target.checked })}
              />
              <label htmlFor="daily_tracked">Track Daily Stock & Variance</label>
            </div>
          </div>

          <button type="submit" className={styles.primaryButton} style={{ marginTop: '1rem' }}>
            Save Item
          </button>
        </form>
      )}

      {/* Filter Bar */}
      <div className={styles.filterBar}>
        <input
          type="text"
          placeholder="Search items by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={styles.searchInput}
        />
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className={styles.selectFilter}
        >
          <option value="all">All Categories</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Items Table */}
      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Loading item master list...
        </div>
      ) : (
        <div className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Category</th>
                <th>UOM</th>
                <th>Daily Tracked</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                    No items found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => (
                  <tr key={item.id}>
                    <td>
                      {editingId === item.id ? (
                        <input
                          type="text"
                          value={editForm.name ?? item.name}
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        />
                      ) : (
                        item.name
                      )}
                    </td>
                    <td>{item.item_categories?.name || 'Uncategorized'}</td>
                    <td>{item.uom}</td>
                    <td>
                      <span className={item.is_daily_tracked ? styles.badgeSuccess : styles.badgeDefault}>
                        {item.is_daily_tracked ? 'Tracked' : 'Untracked'}
                      </span>
                    </td>
                    <td>
                      <span className={item.is_active ? styles.badgeSuccess : styles.badgeDanger}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {editingId === item.id ? (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => handleSaveEdit(item.id)}
                          >
                            Save
                          </button>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => {
                              setEditingId(item.id);
                              setEditForm(item);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => handleToggleActive(item)}
                          >
                            {item.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
