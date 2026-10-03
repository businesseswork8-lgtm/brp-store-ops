'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './users.module.css';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
  store_access: string[];
}

interface Store {
  id: string;
  name: string;
  brand: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  const [editRole, setEditRole] = useState<string>('');
  const [editStoreAccess, setEditStoreAccess] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [profilesRes, storesRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('stores').select('id, name, brand')
      ]);

      if (profilesRes.data) setUsers(profilesRes.data);
      if (storesRes.data) setStores(storesRes.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (user: Profile) => {
    setEditingUserId(user.id);
    setEditRole(user.role);
    setEditStoreAccess(user.store_access || []);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
  };

  const handleStoreToggle = (storeId: string) => {
    setEditStoreAccess(prev => 
      prev.includes(storeId) 
        ? prev.filter(id => id !== storeId)
        : [...prev, storeId]
    );
  };

  const handleSave = async (userId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          role: editRole,
          store_access: editStoreAccess 
        })
        .eq('id', userId);

      if (error) throw error;
      
      setUsers(users.map(u => 
        u.id === userId 
          ? { ...u, role: editRole, store_access: editStoreAccess } 
          : u
      ));
      setEditingUserId(null);
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN');
  };

  const getRoleBadgeClass = (role: string) => {
    switch(role) {
      case 'super_admin': return styles.roleSuperAdmin;
      case 'admin': return styles.roleAdmin;
      default: return styles.roleStore;
    }
  };

  const getStoreNames = (storeIds: string[]) => {
    if (!storeIds || storeIds.length === 0) return <span className={styles.storeBadge}>No Access</span>;
    if (storeIds.length === stores.length && stores.length > 0) return <span className={styles.storeBadge}>All Stores</span>;
    
    return storeIds.map(id => {
      const store = stores.find(s => s.id === id);
      return store ? <span key={id} className={styles.storeBadge}>{store.name}</span> : null;
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>User Management</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage roles and store access for staff</p>
        </div>
      </div>

      <div className={styles.infoBox}>
        ℹ️ <strong>How to add a new user:</strong> For security reasons in Phase 1, new user accounts must be created in the Supabase Authentication dashboard. Once created there, they will automatically appear in this list, and you can edit their role and store access here.
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading users...</div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Store Access</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isEditing = editingUserId === user.id;
                
                return (
                  <tr key={user.id} className={isEditing ? styles.editRow : ''}>
                    <td>{user.full_name || 'N/A'}</td>
                    <td>{user.email}</td>
                    
                    <td>
                      {isEditing ? (
                        <select 
                          className={styles.select}
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                        >
                          <option value="store_staff">Store Staff</option>
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      ) : (
                        <span className={`${styles.badge} ${getRoleBadgeClass(user.role)}`}>
                          {user.role?.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    
                    <td>
                      {isEditing ? (
                        <div className={styles.checkboxList}>
                          {stores.map(store => (
                            <label key={store.id} className={styles.checkboxItem}>
                              <input 
                                type="checkbox" 
                                checked={editStoreAccess.includes(store.id)}
                                onChange={() => handleStoreToggle(store.id)}
                              />
                              {store.name}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div style={{ maxWidth: '250px', display: 'flex', flexWrap: 'wrap' }}>
                          {getStoreNames(user.store_access)}
                        </div>
                      )}
                    </td>
                    
                    <td>{formatDate(user.created_at)}</td>
                    
                    <td>
                      {isEditing ? (
                        <div className={styles.actionCell}>
                          <button 
                            className={styles.btn} 
                            onClick={() => handleSave(user.id)}
                            disabled={saving}
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button 
                            className={styles.btnSecondary} 
                            onClick={handleCancelEdit}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button 
                          className={styles.btnSecondary} 
                          onClick={() => handleEditClick(user)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
