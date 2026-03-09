/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import type { FormEvent, MouseEvent, UIEvent } from 'react';
import { 
  FileText, Search, Download, File, Image as ImageIcon, 
  Video, FileArchive, FileSpreadsheet, FileAudio, Folder, 
  ArrowRight, X, ZoomIn, ZoomOut, RotateCw, Lock, Unlock, Settings, Users, ShieldAlert, Plus, Minus, Copy, Trash2, ArrowUp, ArrowDown, CheckCircle, AlertCircle, MoreHorizontal, Upload, ChevronDown
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import TopupPanel from './components/TopupPanel';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  iconLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  isLocked?: boolean;
  cost?: number;
  unlocked?: boolean;
}

interface FolderPath {
  id: string | null; // null means root
  name: string;
}

interface UserInfo {
  name: string;
  email: string;
  picture: string;
  points: number;
  isAdmin: boolean;
}

function NumberInput({ value, onChange, className }: { value: number, onChange: (val: number) => void, className?: string }) {
  const [localValue, setLocalValue] = useState(value.toString());

  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  const handleBlur = () => {
    const parsed = parseInt(localValue);
    if (!isNaN(parsed) && parsed !== value) {
      onChange(parsed);
    } else {
      setLocalValue(value.toString());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  return (
    <input 
      type="number" 
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
}

function AdminPanel() {
  const [users, setUsers] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFolderId, setNewFolderId] = useState('');
  const [newFolderCost, setNewFolderCost] = useState('');
  
  const [userSearch, setUserSearch] = useState('');
  const [folderSearch, setFolderSearch] = useState('');

  const [sortField, setSortField] = useState<'name' | 'email' | 'points'>('points');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, foldersRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/folders')
      ]);
      if (!usersRes.ok || !foldersRes.ok) throw new Error('Failed to fetch admin data');
      setUsers(await usersRes.json());
      setFolders(await foldersRes.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updatePoints = async (email: string, points: number) => {
    try {
      const res = await fetch('/api/admin/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, points })
      });
      if (!res.ok) throw new Error('Failed to update points');
      fetchData();
      showToast('Points updated successfully');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const bulkAddPoints = async () => {
    const pointsStr = prompt('Enter points to add to ALL users (can be negative):', '10');
    if (!pointsStr) return;
    const points = parseInt(pointsStr);
    if (isNaN(points)) return showToast('Invalid number', 'error');

    try {
      const res = await fetch('/api/admin/points/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points, action: 'add' })
      });
      if (!res.ok) throw new Error('Failed to add points');
      fetchData();
      showToast(`Added ${points} points to all users`);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const deleteUser = async (email: string) => {
    if (!confirm(`Are you sure you want to delete user ${email}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete user');
      fetchData();
      showToast('User deleted successfully');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const updateFolder = async (folderId: string, cost: number | null) => {
    try {
      const res = await fetch('/api/admin/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, cost })
      });
      if (!res.ok) throw new Error('Failed to update folder');
      setNewFolderId('');
      setNewFolderCost('');
      fetchData();
      showToast(cost === null ? 'Folder lock removed' : 'Folder lock added');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleSort = (field: 'name' | 'email' | 'points') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder(field === 'points' ? 'desc' : 'asc');
    }
  };

  const filteredUsers = users
    .filter(u => 
      u.name.toLowerCase().includes(userSearch.toLowerCase()) || 
      u.email.toLowerCase().includes(userSearch.toLowerCase())
    )
    .sort((a, b) => {
      let comparison = 0;
      if (sortField === 'points') {
        comparison = a.points - b.points;
      } else {
        comparison = a[sortField].localeCompare(b[sortField]);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const filteredFolders = folders.filter(f => 
    f.id.toLowerCase().includes(folderSearch.toLowerCase())
  );

  const totalPoints = users.reduce((acc, u) => acc + u.points, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="flex-1 flex flex-col w-full max-w-7xl mx-auto relative text-white"
    >
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-6 py-4 rounded-2xl shadow-xl border font-mono text-xs uppercase tracking-widest ${
              toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <header className="mb-8 text-white">
        <h1 className="font-display text-3xl font-semibold mb-2">Admin Dashboard</h1>
        <p className="text-white/70 text-sm">Manage users, points, and access control</p>
      </header>

      <div className="flex flex-col gap-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : error ? (
          <div className="text-red-600 p-6 bg-red-50 rounded-2xl border border-red-100">{error}</div>
        ) : (
          <>
            {/* Dashboard Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[2rem] p-1.5 flex flex-col shadow-xl">
                <div className="bg-white/95 rounded-[1.5rem] p-6 flex flex-col gap-3 shadow-sm h-full">
                  <div className="text-slate-500 flex items-center gap-2 text-sm font-medium"><Users size={16} /> Total Users</div>
                  <div className="font-display text-4xl font-semibold text-slate-800">{users.length}</div>
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[2rem] p-1.5 flex flex-col shadow-xl">
                <div className="bg-white/95 rounded-[1.5rem] p-6 flex flex-col gap-3 shadow-sm h-full">
                  <div className="text-slate-500 flex items-center gap-2 text-sm font-medium"><Plus size={16} /> Total Points</div>
                  <div className="font-display text-4xl font-semibold text-blue-600">{totalPoints}</div>
                </div>
              </div>
              <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[2rem] p-1.5 flex flex-col shadow-xl">
                <div className="bg-white/95 rounded-[1.5rem] p-6 flex flex-col gap-3 shadow-sm h-full">
                  <div className="text-slate-500 flex items-center gap-2 text-sm font-medium"><Lock size={16} /> Locked Folders</div>
                  <div className="font-display text-4xl font-semibold text-amber-600">{folders.length}</div>
                </div>
              </div>
            </div>

            {/* Users Section */}
            <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[2rem] p-1.5 shadow-xl">
              <section className="bg-white/95 rounded-[1.5rem] overflow-hidden text-slate-800">
                <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h3 className="font-display text-xl font-medium flex items-center gap-2"><Users size={20} className="text-blue-500" /> Users & Points</h3>
                <div className="flex items-center gap-3">
                  <button onClick={bulkAddPoints} className="bg-slate-50 border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors flex items-center gap-2">
                    <Plus size={16} /> Bulk Add
                  </button>
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search users..." 
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all w-full sm:w-64"
                    />
                  </div>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div className="grid grid-cols-12 gap-4 p-4 border-b border-slate-100 font-mono text-[10px] uppercase tracking-widest text-slate-400 bg-slate-50/50">
                    <div className="col-span-4 cursor-pointer hover:text-slate-700 flex items-center gap-1" onClick={() => handleSort('name')}>
                      User {sortField === 'name' && (sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </div>
                    <div className="col-span-4 cursor-pointer hover:text-slate-700 flex items-center gap-1" onClick={() => handleSort('email')}>
                      Email {sortField === 'email' && (sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </div>
                    <div className="col-span-3 text-right cursor-pointer hover:text-slate-700 flex items-center justify-end gap-1" onClick={() => handleSort('points')}>
                      {sortField === 'points' && (sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)} Points
                    </div>
                    <div className="col-span-1 text-right"></div>
                  </div>
                  {filteredUsers.map(u => (
                    <div key={u.email} className="grid grid-cols-12 gap-4 p-4 border-b border-slate-50 items-center hover:bg-slate-50 transition-colors">
                      <div className="col-span-4 font-medium text-slate-800 truncate">{u.name}</div>
                      <div className="col-span-4 text-sm text-slate-500 truncate">{u.email}</div>
                      <div className="col-span-3 flex items-center justify-end gap-2">
                        <button onClick={() => updatePoints(u.email, Math.max(0, u.points - 10))} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"><Minus size={14} /></button>
                        <NumberInput 
                          value={u.points}
                          onChange={(val) => updatePoints(u.email, val)}
                          className="font-mono text-sm font-bold w-16 text-center text-blue-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none transition-colors"
                        />
                        <button onClick={() => updatePoints(u.email, u.points + 10)} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"><Plus size={14} /></button>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => deleteUser(u.email)} className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors" title="Delete User">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {filteredUsers.length === 0 && <div className="p-10 text-center text-slate-400">No users found</div>}
                </div>
              </div>
              </section>
            </div>

            {/* Folders Section */}
            <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[2rem] p-1.5 shadow-xl">
              <section className="bg-white/95 rounded-[1.5rem] overflow-hidden text-slate-800">
                <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h3 className="font-display text-xl font-medium flex items-center gap-2"><Lock size={20} className="text-amber-500" /> Locked Folders</h3>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Search folders..." 
                    value={folderSearch}
                    onChange={(e) => setFolderSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all w-full sm:w-64"
                  />
                </div>
              </div>
              
              <div className="p-6 bg-slate-50/50 border-b border-slate-100">
                <form 
                  onSubmit={(e) => { e.preventDefault(); updateFolder(newFolderId, parseInt(newFolderCost)); }}
                  className="flex flex-col sm:flex-row gap-4 items-end"
                >
                  <div className="flex-1 w-full">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Folder ID</label>
                    <input type="text" value={newFolderId} onChange={e => setNewFolderId(e.target.value)} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all bg-white" placeholder="e.g. 1A2b3C..." />
                  </div>
                  <div className="w-full sm:w-40">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Cost (Points)</label>
                    <input type="number" value={newFolderCost} onChange={e => setNewFolderCost(e.target.value)} required min="0" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all bg-white" placeholder="e.g. 50" />
                  </div>
                  <button type="submit" className="w-full sm:w-auto bg-slate-800 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-900 transition-colors shadow-sm">
                    Add Lock
                  </button>
                </form>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[500px]">
                  <div className="grid grid-cols-12 gap-4 p-4 border-b border-slate-100 font-mono text-[10px] uppercase tracking-widest text-slate-400 bg-slate-50/50">
                    <div className="col-span-8">Folder ID</div>
                    <div className="col-span-4 text-right">Cost (Points)</div>
                  </div>
                  {filteredFolders.map(f => (
                    <div key={f.id} className="grid grid-cols-12 gap-4 p-4 border-b border-slate-50 items-center hover:bg-slate-50 transition-colors">
                      <div className="col-span-8 font-mono text-sm text-slate-600 truncate">{f.id}</div>
                      <div className="col-span-4 flex items-center justify-end gap-4">
                        <NumberInput 
                          value={f.cost}
                          onChange={(val) => updateFolder(f.id, val)}
                          className="font-mono text-sm font-bold w-16 text-right text-amber-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-amber-500 focus:outline-none transition-colors"
                        />
                        <button onClick={() => updateFolder(f.id, null)} className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg">Remove</button>
                      </div>
                    </div>
                  ))}
                  {filteredFolders.length === 0 && <div className="p-10 text-center text-slate-400">No locked folders found</div>}
                </div>
              </div>
              </section>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default function App() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [path, setPath] = useState<FolderPath[]>([{ id: null, name: 'Archive' }]);
  const [error, setError] = useState<string | null>(null);

  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pdfScale, setPdfScale] = useState(0.7);
  const [pdfRotation, setPdfRotation] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ loaded: number, total?: number } | null>(null);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);

  const [currentView, setCurrentView] = useState<'explorer' | 'admin'>('explorer');
  const [showTopup, setShowTopup] = useState(false);
  const [unlockingFolder, setUnlockingFolder] = useState<DriveFile | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0.5);

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const clientHeight = e.currentTarget.clientHeight;
    const isDesktop = window.innerWidth >= 1024;
    const headerHeight = isDesktop ? 100 : 160;
    const maxScroll = clientHeight * 0.85 - headerHeight;
    const progress = Math.min(Math.max(scrollTop / maxScroll, 0), 1);
    setScrollProgress(progress);
  };

  const currentFolderId = path[path.length - 1].id;

  const [background, setBackground] = useState('/backgrounds/abstract-block-color-wavy-lines-orange-and-blue-25-09-2024-1727333608-hd-wallpaper (3).jpeg');

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (currentView === 'explorer' && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          const clientHeight = scrollRef.current.clientHeight;
          const isDesktop = window.innerWidth >= 1024;
          const headerHeight = isDesktop ? 100 : 160;
          // We want the file list to occupy 70% of the space below the header.
          // This means the top of the file list should be at 30% of the space below the header.
          // File list position = 0.85 * clientHeight - scrollTop
          // Target position = headerHeight + 0.3 * (clientHeight - headerHeight)
          // scrollTop = 0.85 * clientHeight - (headerHeight + 0.3 * clientHeight - 0.3 * headerHeight)
          // scrollTop = 0.55 * clientHeight - 0.7 * headerHeight
          const targetScrollTop = 0.55 * clientHeight - 0.7 * headerHeight;
          scrollRef.current.scrollTop = targetScrollTop;
          
          const maxScroll = clientHeight * 0.85 - headerHeight;
          const progress = Math.min(Math.max(targetScrollTop / maxScroll, 0), 1);
          setScrollProgress(progress);
        }
      });
    }
  }, [currentView]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const scrollEl = scrollRef.current;
      const overviewEl = overviewRef.current;
      if (!scrollEl || !overviewEl) return;

      const isOverOverview = overviewEl.contains(e.target as Node);
      if (!isOverOverview) return;

      const isFileListFullyDown = scrollEl.scrollTop <= 0;
      const isOverviewAtBottom = Math.abs(overviewEl.scrollHeight - overviewEl.scrollTop - overviewEl.clientHeight) <= 2;

      if (!isFileListFullyDown) {
        e.preventDefault();
        scrollEl.scrollTop += e.deltaY;
      } else {
        if (e.deltaY > 0 && isOverviewAtBottom) {
          e.preventDefault();
          scrollEl.scrollTop += e.deltaY;
        }
      }
    };

    let touchStartY = 0;
    let touchLastY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
      touchLastY = touchStartY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const scrollEl = scrollRef.current;
      const overviewEl = overviewRef.current;
      if (!scrollEl || !overviewEl) return;

      const isOverOverview = overviewEl.contains(e.target as Node);
      if (!isOverOverview) return;

      const currentY = e.touches[0].clientY;
      const deltaY = touchLastY - currentY;
      touchLastY = currentY;

      const isFileListFullyDown = scrollEl.scrollTop <= 0;
      const isOverviewAtBottom = Math.abs(overviewEl.scrollHeight - overviewEl.scrollTop - overviewEl.clientHeight) <= 2;

      if (!isFileListFullyDown) {
        e.preventDefault();
        scrollEl.scrollTop += deltaY;
      } else {
        if (deltaY > 0 && isOverviewAtBottom) {
          e.preventDefault();
          scrollEl.scrollTop += deltaY;
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsLoggedIn(data.loggedIn);
      setUser(data.user || null);
    } catch (err) {
      console.error('Auth status error:', err);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        checkAuthStatus();
        setPath([{ id: null, name: 'Archive' }]);
        fetchFiles('', null, null);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    fetchFiles('', null, currentFolderId);
    setSelectedFiles(new Set());
  }, [currentFolderId]);

  const fetchFiles = async (query = '', pageToken: string | null = null, folderId: string | null = null) => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/drive/files', window.location.origin);
      if (query) url.searchParams.append('q', query);
      if (pageToken) url.searchParams.append('pageToken', pageToken);
      if (folderId) url.searchParams.append('folderId', folderId);

      const res = await fetch(url.toString());
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch files');
      }
      
      if (pageToken) {
        setFiles(prev => [...prev, ...(data.files || [])]);
      } else {
        setFiles(data.files || []);
      }
      setNextPageToken(data.nextPageToken || null);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    fetchFiles(searchQuery, null, currentFolderId);
  };

  const handleLogin = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await fetch(`/api/auth/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      
      const authWindow = window.open(
        data.url,
        'oauth_popup',
        'width=600,height=700'
      );

      if (!authWindow) {
        alert('Please allow popups for this site to connect your account.');
      }
    } catch (error) {
      console.error('OAuth error:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setIsLoggedIn(false);
      setUser(null);
      setPath([{ id: null, name: 'Archive' }]);
      fetchFiles('', null, null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleDownload = (e: MouseEvent, file: DriveFile) => {
    e.stopPropagation();
    window.open(`/api/drive/download/${file.id}`, '_blank');
  };

  const handleRowClick = (file: DriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      if (file.isLocked && !file.unlocked) {
        setUnlockingFolder(file);
        setUnlockError(null);
        return;
      }
      setPath(prev => [...prev, { id: file.id, name: file.name }]);
      setSearchQuery('');
    } else {
      openPreview(file);
    }
  };

  const handleUnlock = async () => {
    if (!unlockingFolder) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const res = await fetch('/api/folder/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: unlockingFolder.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to unlock');
      
      // Update user points
      setUser(prev => prev ? { ...prev, points: data.points } : prev);
      
      // Update file status
      setFiles(prev => prev.map(f => f.id === unlockingFolder.id ? { ...f, unlocked: true } : f));
      
      setUnlockingFolder(null);
      
      // Navigate to the folder
      setPath(prev => [...prev, { id: unlockingFolder.id, name: unlockingFolder.name }]);
      setSearchQuery('');
    } catch (err: any) {
      setUnlockError(err.message);
    } finally {
      setUnlocking(false);
    }
  };

  const openPreview = async (file: DriveFile) => {
    setPreviewFile(file);
    setPreviewContent(null);
    setPreviewError(null);
    setNumPages(undefined);
    setPageNumber(1);
    setPdfScale(0.7);
    setPdfRotation(0);
    
    // Check if it's a text-like file
    if (file.mimeType.startsWith('text/') || 
        file.mimeType === 'application/json' || 
        file.mimeType === 'application/javascript' || 
        file.mimeType === 'application/xml') {
      setPreviewLoading(true);
      try {
        const res = await fetch(`/api/drive/download/${file.id}`);
        if (!res.ok) throw new Error('Failed to load text content');
        const text = await res.text();
        setPreviewContent(text);
      } catch (err: any) {
        setPreviewError(err.message);
      } finally {
        setPreviewLoading(false);
      }
    } else if (file.mimeType === 'application/pdf') {
      setPreviewContent(`/api/drive/download/${file.id}?inline=true`);
    }
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewContent(null);
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const navigateToPath = (index: number) => {
    setPath(prev => prev.slice(0, index + 1));
    setSearchQuery('');
  };

  const formatSize = (bytes?: string | number) => {
    if (bytes === undefined || bytes === null || bytes === '') return '--';
    const size = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (isNaN(size) || size === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(size) / Math.log(k));
    return parseFloat((size / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType === 'application/vnd.google-apps.folder') return <Folder size={20} strokeWidth={1} />;
    if (mimeType.includes('image')) return <ImageIcon size={20} strokeWidth={1} />;
    if (mimeType.includes('video')) return <Video size={20} strokeWidth={1} />;
    if (mimeType.includes('audio')) return <FileAudio size={20} strokeWidth={1} />;
    if (mimeType.includes('pdf')) return <FileText size={20} strokeWidth={1} />;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return <FileSpreadsheet size={20} strokeWidth={1} />;
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) return <FileArchive size={20} strokeWidth={1} />;
    return <File size={20} strokeWidth={1} />;
  };

  const toggleSelection = (e: React.ChangeEvent<HTMLInputElement> | React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.id)));
    }
  };

  const handleBatchDownload = async () => {
    if (selectedFiles.size === 0) return;
    setIsBatchDownloading(true);
    setDownloadProgress({ loaded: 0 });
    try {
      const res = await fetch('/api/drive/download-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fileIds: Array.from(selectedFiles) })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to download files');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Failed to start download stream');

      const contentLength = res.headers.get('Content-Length') || res.headers.get('X-Estimated-Content-Length');
      const total = contentLength ? parseInt(contentLength, 10) : undefined;

      let receivedLength = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        if (value) {
          chunks.push(value);
          receivedLength += value.length;
          setDownloadProgress({ loaded: receivedLength, total });
        }
      }

      const blob = new Blob(chunks, { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'archive.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSelectedFiles(new Set());
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsBatchDownloading(false);
      setDownloadProgress(null);
    }
  };

  return (
    <div ref={containerRef} className="h-[100dvh] w-full overflow-hidden flex text-white relative font-sans" style={{ backgroundImage: `url(${background})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <div className="bg-fluid"></div>
      
      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Header */}
        <header className="absolute top-0 left-0 right-0 z-30 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 w-full px-4 sm:px-8 pt-6 pb-4 transition-all pointer-events-none">
          {/* Left: Title & Logo & Sign In (Mobile) */}
          <div className="flex items-center justify-between w-full lg:w-1/3 pointer-events-auto">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md border border-white/30">
                  <Folder size={16} />
                </div>
                <span className="font-display font-medium tracking-wide text-sm">Drive Explorer</span>
              </div>
              <div className="flex items-baseline gap-3">
                <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">Overview Panel</h1>
                <span className="text-[10px] uppercase tracking-widest text-white/60">{format(new Date(), 'MMM dd, yyyy')}</span>
              </div>
            </div>
            
            {/* Mobile Sign In */}
            <div className="lg:hidden shrink-0 ml-4">
              {isLoggedIn && user ? (
                <div className="glass-pill px-1.5 py-1.5 flex items-center gap-2 pr-2 cursor-pointer hover:bg-white/10 transition-colors" onClick={() => setShowTopup(true)}>
                  <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full border border-white/30" referrerPolicy="no-referrer" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-medium text-white/90">{user.points} PTS</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleLogout(); }} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button onClick={handleLogin} className="glass-pill px-4 py-1.5 text-xs font-medium hover:bg-white/20 transition-colors">
                  Sign In
                </button>
              )}
            </div>
          </div>
          
          {/* Center: Global Controls */}
          <div className="flex items-center justify-center lg:w-1/3 pointer-events-auto">
            <div className="glass-pill p-1 flex items-center gap-1 flex-wrap justify-center">
              <button 
                onClick={() => setCurrentView('explorer')} 
                className={`px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${currentView === 'explorer' ? 'bg-white text-slate-900 shadow-sm' : 'text-white hover:bg-white/10'}`}
              >
                <Folder size={16} />
                <span className={`${currentView === 'explorer' ? 'block' : 'hidden'} sm:block`}>Archive</span>
              </button>
              {user?.isAdmin && (
                <button 
                  onClick={() => setCurrentView('admin')} 
                  className={`px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${currentView === 'admin' ? 'bg-white text-slate-900 shadow-sm' : 'text-white hover:bg-white/10'}`}
                >
                  <Settings size={16} />
                  <span className={`${currentView === 'admin' ? 'block' : 'hidden'} sm:block`}>Admin Panel</span>
                </button>
              )}
              <div className="w-px h-6 bg-white/20 mx-1"></div>
              <button onClick={() => setShowTopup(true)} className="px-3 sm:px-4 py-2 rounded-full text-sm font-medium text-white hover:bg-white/10 transition-all flex items-center gap-2">
                <Plus size={16} /> <span className="hidden sm:block">Credits</span>
              </button>
              <button className="px-3 sm:px-4 py-2 rounded-full text-sm font-medium text-white hover:bg-white/10 transition-all flex items-center gap-2">
                <Upload size={16} /> <span className="hidden sm:block">Upload</span>
              </button>
            </div>
          </div>
          
          {/* Right: User Info (Desktop) */}
          <div className="hidden lg:flex items-center justify-end lg:w-1/3 pointer-events-auto">
            {isLoggedIn && user ? (
              <div className="glass-pill px-2 py-1.5 flex items-center gap-3 pr-4 cursor-pointer hover:bg-white/10 transition-colors" onClick={() => setShowTopup(true)}>
                <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full border border-white/30" referrerPolicy="no-referrer" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">{user.name.split(' ')[0]}</span>
                  <span className="text-[10px] text-white/70">{user.points} PTS</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleLogout(); }} className="ml-2 p-1.5 hover:bg-white/20 rounded-full transition-colors">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button onClick={handleLogin} className="glass-pill px-6 py-2 text-sm font-medium hover:bg-white/20 transition-colors">
                Sign In
              </button>
            )}
          </div>
        </header>
        
        {currentView === 'admin' ? (
          <div className="absolute top-[160px] lg:top-[100px] left-0 right-0 bottom-0 overflow-y-auto z-10 pb-24 px-4 sm:px-8 pointer-events-auto hide-scrollbar">
             <AdminPanel />
          </div>
        ) : (
          <>
            {/* Background Overview Panel */}
            <div 
              ref={overviewRef}
              className="absolute top-[160px] lg:top-[100px] left-0 right-0 bottom-0 overflow-y-auto z-10 pb-24 hide-scrollbar transition-transform duration-75"
              style={{ 
                opacity: 1 - scrollProgress * 0.7,
                transform: `scale(${1 - scrollProgress * 0.1}) translateY(${scrollProgress * 20}px)`,
              }}
            >
              <div className="px-4 sm:px-8 pt-6 pb-12 flex flex-col lg:flex-row gap-6 w-full">
                {/* Left: Single Small Card */}
                  <div className="w-full lg:w-1/4">
                    <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[2rem] p-1.5 flex flex-col shadow-xl">
                      <div className="bg-white/90 rounded-[1.5rem] p-4 flex flex-col shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-slate-500 font-medium text-xs">Available Points</span>
                          <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                            <Lock size={16} />
                          </div>
                        </div>
                        <div className="font-display text-3xl font-semibold text-slate-800">{user?.points || 0}</div>
                        <div className="text-slate-400 text-[10px] mt-1">Used for unlocking</div>
                      </div>
                      <div className="px-4 py-3 flex items-center justify-between">
                        <span className="text-white/90 text-xs font-medium tracking-wide">Get More</span>
                        <button className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-slate-900 shadow-sm hover:scale-105 transition-transform">
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Middle: Empty Space */}
                  <div className="hidden lg:block lg:flex-1"></div>

                  {/* Right: Stacked Contextual Widget */}
                  <div className="w-full lg:w-2/5 xl:w-[35%]">
                    <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-[2rem] flex flex-col shadow-2xl overflow-hidden h-full min-h-[260px]">
                      {/* Upper Context Zone (30-40%) */}
                      <div className="p-5 pb-4 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-display text-base font-medium text-white">Activity Matrix</h3>
                          <span className="text-[10px] text-white/80 bg-white/20 px-2 py-1 rounded-full border border-white/10">This Week</span>
                        </div>
                        {/* Grid Layout for Days */}
                        <div className="grid grid-cols-7 gap-2">
                          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
                            <div key={i} className="flex flex-col items-center gap-1.5">
                              <span className="text-[9px] text-white/60 font-mono uppercase">{day}</span>
                              <div className={`w-full aspect-square rounded-full flex items-center justify-center transition-all ${i === 3 ? 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)] scale-110' : 'bg-white/10 hover:bg-white/20'}`}>
                                {i === 3 && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Nested Data Container (60-70%) */}
                      <div className="bg-white/95 rounded-[1.5rem] m-1.5 mt-0 p-4 flex-1 flex flex-col shadow-inner border border-white/50">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-display text-sm font-semibold text-slate-800">Recent Transactions</h4>
                          <button className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                        
                        <div className="flex flex-col gap-3 flex-1">
                          {/* List Item 1 */}
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                              <Download size={16} />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0 justify-center">
                              <span className="text-xs font-medium text-slate-800 truncate leading-snug">Project_Alpha.zip</span>
                              <span className="text-[10px] text-slate-400 leading-snug">Today, 10:42 AM</span>
                            </div>
                            <div className="text-right shrink-0 flex items-center">
                              <span className="text-sm font-semibold text-emerald-600">+12 PTS</span>
                            </div>
                          </div>
                          
                          {/* List Item 2 */}
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
                              <Unlock size={16} />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0 justify-center">
                              <span className="text-xs font-medium text-slate-800 truncate leading-snug">Q3_Financials.pdf</span>
                              <span className="text-[10px] text-slate-400 leading-snug">Yesterday</span>
                            </div>
                            <div className="text-right shrink-0 flex items-center">
                              <span className="text-sm font-semibold text-amber-600">-50 PTS</span>
                            </div>
                          </div>

                          {/* List Item 3 */}
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                              <Upload size={16} />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0 justify-center">
                              <span className="text-xs font-medium text-slate-800 truncate leading-snug">Design_Assets.fig</span>
                              <span className="text-[10px] text-slate-400 leading-snug">Oct 12</span>
                            </div>
                            <div className="text-right shrink-0 flex items-center">
                              <span className="text-sm font-semibold text-slate-600">0 PTS</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            
            {/* Foreground File List Overlay */}
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="absolute top-0 left-0 right-0 bottom-0 overflow-y-auto z-20 pointer-events-none hide-scrollbar"
            >
              {/* Spacer to push FileList down initially */}
              <div className="h-[85dvh] pointer-events-none w-full" />
              
              {/* File List Container */}
              <div className="sticky top-[200px] lg:top-[140px] z-40 px-4 sm:px-8 pb-6 h-[calc(100dvh-200px)] lg:h-[calc(100dvh-140px)] pointer-events-auto flex flex-col">
                <div className="solid-card rounded-3xl p-2 sm:p-6 flex flex-col text-slate-800 shadow-2xl border border-white/20 bg-white/95 backdrop-blur-xl h-full overflow-hidden">
                  {/* Drag Handle Indicator (Mobile) */}
                  <div className="w-full flex justify-center pt-2 pb-4 lg:hidden sticky top-0 z-10 bg-transparent">
                    <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
                  </div>
                  
                  <div className="sticky top-0 z-20 bg-transparent pb-2">
                    {/* Breadcrumbs & Actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 px-4 pt-2 gap-4">
                      <nav className="font-mono text-[10px] sm:text-xs uppercase tracking-widest text-slate-400 flex items-center gap-2 overflow-x-auto hide-scrollbar">
                        {path.map((p, i) => (
                          <span key={p.id || 'root'} className="flex items-center gap-2 whitespace-nowrap">
                            {i > 0 && <span>/</span>}
                            <button 
                              onClick={() => navigateToPath(i)} 
                              className={`hover:text-slate-800 transition-colors ${i === path.length - 1 ? 'text-slate-800 font-bold' : ''}`}
                            >
                              {p.name}
                            </button>
                          </span>
                        ))}
                      </nav>

                      <AnimatePresence>
                        {selectedFiles.size > 0 && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.9, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 10 }}
                            className="flex items-center gap-3 bg-slate-900 text-white px-4 py-2 rounded-full shadow-lg self-start sm:self-auto"
                          >
                            <span className="text-xs font-medium">{selectedFiles.size} selected</span>
                            <div className="w-px h-4 bg-white/20"></div>
                            <button 
                              onClick={handleBatchDownload}
                              disabled={isBatchDownloading}
                              className="flex items-center gap-2 text-xs font-medium hover:text-emerald-400 transition-colors disabled:opacity-50"
                            >
                              <Download size={14} />
                              {isBatchDownloading ? 'Downloading...' : 'Download'}
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Header Row */}
                    <div className="grid grid-cols-[32px_1fr_40px] sm:grid-cols-[40px_40px_1fr_100px_80px_80px] gap-2 items-center pb-3 mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-100 px-2 sm:px-4">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={files.length > 0 && selectedFiles.size === files.length}
                          onChange={toggleSelectAll}
                          className="custom-checkbox"
                        />
                      </div>
                      <div className="hidden sm:block">TYPE</div>
                      <div>TITLE</div>
                      <div className="hidden sm:block">DATE</div>
                      <div className="hidden sm:block">SIZE</div>
                      <div className="text-right">ACTION</div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-1 sm:px-2">
                    <AnimatePresence mode="popLayout">
                      {files.map((file, i) => {
                        const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                        return (
                          <motion.div
                            key={file.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.3 }}
                            onClick={() => handleRowClick(file)}
                            className={`group grid grid-cols-[32px_1fr_40px] sm:grid-cols-[40px_40px_1fr_100px_80px_80px] gap-2 items-center py-2 sm:py-3 cursor-pointer rounded-2xl px-2 transition-all hover:bg-slate-50 ${selectedFiles.has(file.id) ? 'bg-slate-50 shadow-sm border border-slate-100' : 'border border-transparent'}`}
                          >
                            <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedFiles.has(file.id)}
                                onChange={(e) => toggleSelection(e as any, file.id)}
                                className="custom-checkbox"
                              />
                            </div>
                            <div className="hidden sm:block text-slate-400 group-hover:text-blue-500 transition-colors">
                              {getFileIcon(file.mimeType)}
                            </div>
                            
                            <div className="font-display text-sm sm:text-base font-medium pr-2 transition-all duration-300 text-slate-700 group-hover:text-slate-900 flex items-start sm:items-center gap-2">
                              <span className="sm:hidden text-slate-400 shrink-0 mt-0.5">{getFileIcon(file.mimeType)}</span>
                              <div className="flex-1 min-w-0">
                                <span className="line-clamp-2 break-words leading-tight">{file.name}</span>
                                {file.isLocked && (
                                  <span className={`mt-1 shrink-0 inline-flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-full border ${file.unlocked ? 'border-emerald-200 text-emerald-600 bg-emerald-50' : 'border-amber-200 text-amber-600 bg-amber-50'}`}>
                                    {file.unlocked ? <Unlock size={10} /> : <Lock size={10} />}
                                    {file.unlocked ? 'Unlocked' : `${file.cost} PTS`}
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="hidden sm:block font-mono text-[11px] text-slate-400">
                              {format(new Date(file.modifiedTime), 'MMM dd, yyyy')}
                            </div>
                            
                            <div className="hidden sm:block font-mono text-[11px] text-slate-400">
                              {formatSize(file.size)}
                            </div>
                            
                            <div className="text-right flex justify-end">
                              {!isFolder ? (
                                <button
                                  onClick={(e) => handleDownload(e, file)}
                                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                >
                                  <Download size={16} />
                                </button>
                              ) : (
                                <button className={`p-2 rounded-full transition-colors ${file.isLocked && !file.unlocked ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}>
                                  {file.isLocked && !file.unlocked ? <Lock size={16} /> : <ArrowRight size={16} />}
                                </button>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                    
                    {files.length === 0 && !loading && !error && (
                      <div className="py-20 flex flex-col items-center justify-center text-slate-300">
                        <Folder size={48} strokeWidth={1} className="mb-4" />
                        <p className="font-display text-lg text-slate-400">Empty Directory</p>
                      </div>
                    )}
                    
                    {loading && (
                      <div className="py-12 flex justify-center">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>
            </div>
            </div>
            </div>
          </>
        )}
      </div>
      

      {/* Modals */}
      {/* Preview Modal */}
      <AnimatePresence>
        {previewFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 sm:p-8"
            onClick={closePreview}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-5xl h-full max-h-[90vh] shadow-2xl flex flex-col overflow-hidden rounded-3xl text-slate-800"
            >
              <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="text-blue-500 shrink-0 bg-blue-50 p-2 rounded-xl">
                    {getFileIcon(previewFile.mimeType)}
                  </div>
                  <h2 className="font-display text-lg sm:text-xl font-medium truncate">{previewFile.name}</h2>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={(e) => handleDownload(e, previewFile)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-blue-600">
                    <Download size={18} />
                  </button>
                  <button onClick={closePreview} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-red-500">
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 sm:p-8 bg-slate-50">
                {previewFile.mimeType.startsWith('image/') ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <img src={`/api/drive/download/${previewFile.id}?inline=true`} alt={previewFile.name} className="max-w-full max-h-full object-contain shadow-md rounded-xl" />
                  </div>
                ) : previewFile.mimeType === 'application/pdf' ? (
                  previewContent ? (
                    <div className="w-full flex flex-col items-center py-4">
                      <Document
                        file={previewContent}
                        onLoadSuccess={onDocumentLoadSuccess}
                        loading={<div className="font-mono text-xs uppercase tracking-widest animate-pulse text-slate-400 my-10">Loading PDF...</div>}
                        className="flex flex-col items-center gap-4"
                      >
                        {Array.from(new Array(numPages || 0), (el, index) => (
                          <div key={`page_${index + 1}`} className="shadow-lg bg-white mb-4 rounded-xl overflow-hidden border border-slate-200">
                            <Page pageNumber={index + 1} scale={1.2} width={Math.min(window.innerWidth * 0.8, 800)} />
                          </div>
                        ))}
                      </Document>
                    </div>
                  ) : null
                ) : previewFile.mimeType.startsWith('text/') || previewFile.mimeType === 'application/json' ? (
                  <div className="w-full h-full bg-white p-6 rounded-2xl shadow-sm overflow-auto border border-slate-200">
                    <pre className="font-mono text-xs sm:text-sm whitespace-pre-wrap break-words text-slate-700">
                      {previewContent}
                    </pre>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-slate-400">
                    <File size={48} strokeWidth={1} className="text-slate-300" />
                    <p className="font-display text-lg">Preview not available</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Unlock Modal */}
      <AnimatePresence>
        {unlockingFolder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4"
            onClick={() => setUnlockingFolder(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-md shadow-2xl flex flex-col overflow-hidden rounded-3xl text-slate-800"
            >
              <div className="p-8 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                  <Lock size={32} />
                </div>
                <h2 className="font-display text-2xl font-semibold mb-2">Locked Folder</h2>
                <p className="text-slate-500 mb-8 truncate w-full px-4">"{unlockingFolder.name}"</p>
                
                <div className="bg-slate-50 w-full p-6 rounded-2xl border border-slate-100 mb-8">
                  <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-200">
                    <span className="font-mono text-xs uppercase tracking-widest text-slate-500">Required</span>
                    <span className="font-mono text-lg font-bold text-amber-600">{unlockingFolder.cost} PTS</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-xs uppercase tracking-widest text-slate-500">Your Balance</span>
                    <span className="font-mono text-lg font-bold text-blue-600">{user?.points || 0} PTS</span>
                  </div>
                </div>

                {unlockError && (
                  <div className="w-full bg-red-50 text-red-600 p-3 rounded-xl text-xs font-mono mb-6 border border-red-100">
                    {unlockError}
                  </div>
                )}

                <div className="flex gap-4 w-full">
                  <button 
                    onClick={() => setUnlockingFolder(null)}
                    className="flex-1 py-3 rounded-xl font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleUnlock}
                    disabled={unlocking || !user || user.points < (unlockingFolder.cost || 0)}
                    className="flex-1 py-3 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md shadow-blue-500/20"
                  >
                    {unlocking ? 'Unlocking...' : (
                      <>
                        <Unlock size={16} />
                        Unlock Now
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTopup && (
          <TopupPanel 
            onClose={() => setShowTopup(false)} 
            onSuccess={(newPoints) => {
              if (user) setUser({ ...user, points: newPoints });
              setShowTopup(false);
            }} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}



