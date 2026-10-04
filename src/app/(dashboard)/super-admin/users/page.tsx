'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './users.module.css';

interface Store {
  id: string;
  name: string;
  code: string;
  brands?: { name: string };
}

interface StaffMember {
  id: string;
  name: string;
  store_id: string;
  is_active: boolean;
  created_at: string;
  stores?: { name: string; code: string };
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  store_access: string[];
  is_active: boolean;
  can_edit?: boolean;
  created_at: string;
}

export default function UserAndStaffManagementPage() {
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<'staff' | 'users'>('staff');
  const [stores, setStores] = useState<Store[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Search filter
  const [search, setSearch] = useState('');
  const [selectedStoreFilter, setSelectedStoreFilter] = useState('all');

  // Staff Member Add Form
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({
    name: '',
    store_id: '',
  });

  // Staff Member Edit Mode
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffForm, setEditStaffForm] = useState<{ name: string; store_id: string }>({
    name: '',
    store_id: '',
  });

  // User Profile Add Form
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'store',
    store_access: [] as string[],
    can_edit: false,
  });

  // User Profile Edit Mode
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState<{ full_name: string; role: string; store_access: string[]; can_edit: boolean }>({
    full_name: '',
    role: 'store',
    store_access: [],
    can_edit: false,
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);

    const [storesRes, staffRes, profilesRes] = await Promise.all([
      supabase.from('stores').select('id, name, code, brands(name)').order('name'),
      supabase.from('staff_members').select('*, stores(name, code)').order('name'),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    ]);

    if (storesRes.data) {
      setStores(storesRes.data as any);
      if (storesRes.data.length > 0 && !newStaff.store_id) {
        setNewStaff(prev => ({ ...prev, store_id: storesRes.data[0].id }));
      }
    }
    if (staffRes.data) setStaffList(staffRes.data as any);
    if (profilesRes.data) setUserProfiles(profilesRes.data as any);

    setLoading(false);
  }

  // --- STAFF MEMBER HANDLERS ---
  async function handleCreateStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!newStaff.name || !newStaff.store_id) return;

    const { error } = await supabase.from('staff_members').insert({
      name: newStaff.name.trim(),
      store_id: newStaff.store_id,
      is_active: true,
    });

    if (!error) {
      setIsAddingStaff(false);
      setNewStaff({ name: '', store_id: stores[0]?.id || '' });
      fetchData();
    } else {
      alert('Error adding staff member: ' + error.message);
    }
  }

  async function handleToggleStaffActive(staff: StaffMember) {
    const { error } = await supabase
      .from('staff_members')
      .update({ is_active: !staff.is_active })
      .eq('id', staff.id);

    if (!error) fetchData();
  }

  async function handleSaveStaffEdit(staffId: string) {
    const { error } = await supabase
      .from('staff_members')
      .update({
        name: editStaffForm.name.trim(),
        store_id: editStaffForm.store_id,
      })
      .eq('id', staffId);

    if (!error) {
      setEditingStaffId(null);
      fetchData();
    }
  }

  async function handleDeleteStaff(staffId: string) {
    if (!confirm('Are you sure you want to delete this staff member?')) return;
    const { error } = await supabase.from('staff_members').delete().eq('id', staffId);
    if (!error) fetchData();
  }

  // --- USER PROFILE HANDLERS ---
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUser.email || !newUser.password || !newUser.full_name) return;

    // Created on the server (service-role key) so the current Super Admin stays logged in
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newUser.email.trim(),
        password: newUser.password,
        full_name: newUser.full_name.trim(),
        role: newUser.role,
        store_access: newUser.store_access,
        can_edit: newUser.can_edit,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert('Could not create login: ' + (result.error || res.statusText));
      return;
    }
    setIsAddingUser(false);
    setNewUser({ full_name: '', email: '', password: '', role: 'store', store_access: [], can_edit: false });
    fetchData();
    alert(`Login ${newUser.email} created.`);
  }

  async function handleToggleUserActive(user: UserProfile) {
    const turningOff = user.is_active;
    if (turningOff && !confirm(`Turn off login for ${user.email}? They will not be able to sign in.`)) return;
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, is_active: !user.is_active }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) alert('Could not update login: ' + (result.error || res.statusText));
    else fetchData();
  }

  async function handleSaveUserEdit(userId: string) {
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: editUserForm.full_name.trim(),
        role: editUserForm.role,
        store_access: editUserForm.store_access,
        can_edit: editUserForm.role === 'admin' ? editUserForm.can_edit : editUserForm.role === 'super_admin',
      })
      .eq('id', userId);

    if (!error) {
      setEditingUserId(null);
      fetchData();
    } else {
      alert('Error updating user profile: ' + error.message);
    }
  }

  function handleUserStoreAccessToggle(storeId: string) {
    setEditUserForm(prev => {
      const exists = prev.store_access.includes(storeId);
      return {
        ...prev,
        store_access: exists
          ? prev.store_access.filter(id => id !== storeId)
          : [...prev.store_access, storeId],
      };
    });
  }

  const filteredStaff = staffList.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchesStore = selectedStoreFilter === 'all' || s.store_id === selectedStoreFilter;
    return matchesSearch && matchesStore;
  });

  const filteredUsers = userProfiles.filter(u => {
    const matchesSearch = (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
                          (u.email || '').toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>User & Store Staff Management Console</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Manage store staff roster for shift logging, and register system login accounts for Store, Admin, and Super Admin accounts
          </p>
        </div>
        <div>
          {activeTab === 'staff' ? (
            <button className={styles.primaryButton} onClick={() => setIsAddingStaff(!isAddingStaff)}>
              {isAddingStaff ? 'Cancel' : '+ Add Store Staff Member'}
            </button>
          ) : (
            <button className={styles.primaryButton} onClick={() => setIsAddingUser(!isAddingUser)}>
              {isAddingUser ? 'Cancel' : '+ Register System User Account'}
            </button>
          )}
        </div>
      </div>

      {/* Tab Controls */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        <button
          style={{
            padding: '0.75rem 1.5rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'staff' ? '3px solid var(--accent-primary)' : '3px solid transparent',
            color: activeTab === 'staff' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('staff')}
        >
          🧑‍🍳 Store Staff Members ({staffList.length})
        </button>

        <button
          style={{
            padding: '0.75rem 1.5rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'users' ? '3px solid var(--accent-primary)' : '3px solid transparent',
            color: activeTab === 'users' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('users')}
        >
          🔐 Login Profiles & Permissions ({userProfiles.length})
        </button>
      </div>

      {/* --- TAB 1: STORE STAFF MEMBERS --- */}
      {activeTab === 'staff' && (
        <>
          {isAddingStaff && (
            <form className={styles.card} onSubmit={handleCreateStaff} style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem 0' }}>Add New Store Staff Member</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Staff Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={newStaff.name}
                    onChange={e => setNewStaff({ ...newStaff, name: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Assigned Store *</label>
                  <select
                    value={newStaff.store_id}
                    onChange={e => setNewStaff({ ...newStaff, store_id: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <button type="submit" className={styles.primaryButton} style={{ marginTop: '1rem' }}>
                Save Staff Member
              </button>
            </form>
          )}

          {/* Filter Bar */}
          <div className={styles.filterBar} style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search staff members by name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={styles.searchInput}
              style={{ flex: 1 }}
            />
            <select
              value={selectedStoreFilter}
              onChange={e => setSelectedStoreFilter(e.target.value)}
              className={styles.selectFilter}
            >
              <option value="all">All Stores</option>
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Staff Table */}
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading staff records...</div>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Staff Name</th>
                    <th>Assigned Store</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStaff.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                        No staff members found. Click "+ Add Store Staff Member" to add store workers.
                      </td>
                    </tr>
                  ) : (
                    filteredStaff.map((staff: any) => (
                      <tr key={staff.id}>
                        <td style={{ fontWeight: 600 }}>
                          {editingStaffId === staff.id ? (
                            <input
                              type="text"
                              value={editStaffForm.name}
                              onChange={e => setEditStaffForm({ ...editStaffForm, name: e.target.value })}
                              style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            />
                          ) : (
                            staff.name
                          )}
                        </td>
                        <td>
                          {editingStaffId === staff.id ? (
                            <select
                              value={editStaffForm.store_id}
                              onChange={e => setEditStaffForm({ ...editStaffForm, store_id: e.target.value })}
                              style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            >
                              {stores.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={styles.storeBadge}>{staff.stores?.name || 'Assigned Store'}</span>
                          )}
                        </td>
                        <td>
                          <span className={staff.is_active ? styles.roleSuperAdmin : styles.roleStore}>
                            {staff.is_active ? '✓ Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          {editingStaffId === staff.id ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className={styles.btn} onClick={() => handleSaveStaffEdit(staff.id)}>
                                Save
                              </button>
                              <button className={styles.btnSecondary} onClick={() => setEditingStaffId(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                className={styles.btnSecondary}
                                onClick={() => {
                                  setEditingStaffId(staff.id);
                                  setEditStaffForm({
                                    name: staff.name,
                                    store_id: staff.store_id,
                                  });
                                }}
                              >
                                Edit
                              </button>
                              <button className={styles.btnSecondary} onClick={() => handleToggleStaffActive(staff)}>
                                {staff.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button className={styles.btnSecondary} style={{ color: 'var(--danger)' }} onClick={() => handleDeleteStaff(staff.id)}>
                                Delete
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
        </>
      )}


      {/* --- TAB 2: SYSTEM LOGIN PROFILES --- */}
      {activeTab === 'users' && (
        <>
          {isAddingUser && (
            <form className={styles.card} onSubmit={handleCreateUser} style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem 0' }}>Register New User Account</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Mithil Kothari"
                    value={newUser.full_name}
                    onChange={e => setNewUser({ ...newUser, full_name: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="user@brp.com"
                    value={newUser.email}
                    onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}>Password</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={newUser.password}
                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem' }}>System Role</label>
                  <select
                    value={newUser.role}
                    onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    <option value="store">Store</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                  Assign Store Access Permissions:
                </label>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {stores.map(store => (
                    <label key={store.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={newUser.store_access.includes(store.id)}
                        onChange={() => {
                          const exists = newUser.store_access.includes(store.id);
                          setNewUser({
                            ...newUser,
                            store_access: exists
                              ? newUser.store_access.filter(id => id !== store.id)
                              : [...newUser.store_access, store.id],
                          });
                        }}
                      />
                      {store.name}
                    </label>
                  ))}
                </div>
              </div>

              {newUser.role === 'admin' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={newUser.can_edit}
                    onChange={e => setNewUser({ ...newUser, can_edit: e.target.checked })}
                  />
                  Allowed to edit store entries
                </label>
              )}
              {newUser.role === 'store' && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
                  A store login must have exactly one store ticked.
                </p>
              )}

              <button type="submit" className={styles.primaryButton} style={{ marginTop: '1.25rem' }}>
                Create Login
              </button>
            </form>
          )}

          {/* User Profiles Table */}
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading user accounts...</div>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Full Name</th>
                    <th>Email Address</th>
                    <th>System Role</th>
                    <th>Store Access</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(user => {
                    const isEditing = editingUserId === user.id;

                    return (
                      <tr key={user.id}>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editUserForm.full_name}
                              onChange={e => setEditUserForm({ ...editUserForm, full_name: e.target.value })}
                              style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            />
                          ) : (
                            user.full_name || 'N/A'
                          )}
                        </td>
                        <td>{user.email}</td>
                        <td>
                          {isEditing ? (
                            <select
                              value={editUserForm.role}
                              onChange={e => setEditUserForm({ ...editUserForm, role: e.target.value })}
                              style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            >
                              <option value="store">Store</option>
                              <option value="admin">Admin</option>
                              <option value="super_admin">Super Admin</option>
                            </select>
                          ) : null}
                          {isEditing && editUserForm.role === 'admin' && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginTop: '0.4rem' }}>
                              <input
                                type="checkbox"
                                checked={editUserForm.can_edit}
                                onChange={e => setEditUserForm({ ...editUserForm, can_edit: e.target.checked })}
                              />
                              Allowed to edit
                            </label>
                          )}
                          {!isEditing && (
                            <span className={`${styles.badge} ${user.role === 'super_admin' ? styles.roleSuperAdmin : user.role === 'admin' ? styles.roleAdmin : styles.roleStore}`}>
                              {user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? (user.can_edit ? 'Admin (can edit)' : 'Admin (view only)') : 'Store'}
                            </span>
                          )}
                          {!user.is_active && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.25rem' }}>Login turned off</div>}
                        </td>
                        <td>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              {stores.map(store => (
                                <label key={store.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={editUserForm.store_access.includes(store.id)}
                                    onChange={() => handleUserStoreAccessToggle(store.id)}
                                  />
                                  {store.name}
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {user.store_access && user.store_access.length > 0 ? (
                                user.store_access.map(sId => {
                                  const st = stores.find(s => s.id === sId);
                                  return <span key={sId} className={styles.storeBadge}>{st ? st.name : sId}</span>;
                                })
                              ) : (
                                <span className={styles.storeBadge}>{user.role === 'store' ? '⚠ No store linked' : 'All stores'}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className={styles.btn} onClick={() => handleSaveUserEdit(user.id)}>
                                Save
                              </button>
                              <button className={styles.btnSecondary} onClick={() => setEditingUserId(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              className={styles.btnSecondary}
                              onClick={() => {
                                setEditingUserId(user.id);
                                setEditUserForm({
                                  full_name: user.full_name || '',
                                  role: user.role || 'store',
                                  store_access: user.store_access || [],
                                  can_edit: Boolean(user.can_edit),
                                });
                              }}
                            >
                              Edit
                            </button>
                          )}
                          {!isEditing && (
                            <button className={styles.btnSecondary} style={{ marginLeft: '0.5rem' }} onClick={() => handleToggleUserActive(user)}>
                              {user.is_active ? 'Turn off login' : 'Turn on login'}
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
        </>
      )}
    </div>
  );
}

