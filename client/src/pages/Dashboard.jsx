import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import Card from '../components/Card';
import Modal from '../components/Modal';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import BackupCard from '../components/BackupCard';
import BackupInspectionModal from '../components/BackupInspectionModal';
import PITRStatusCard from '../components/PITRStatusCard';
import ChangePasswordModal from '../components/ChangePasswordModal';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';

// Fallback if config doesn't exist, or we can export it from api.js if we modified it.
// Ideally, we should unify this. For now, let's hardcode relative or get it from window location if needed, 
// but since api.js likely has it... verify first.
// Actually, looking at the previous view_file of api.js (which I will do next), I'll see what to do.
// But I need to perform this replace AFTER checking api.js. 
// Wait, I can't wait. The error is blocking.
// Let's assume standard Vite env usage or hardcode for now to unblock.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const Dashboard = () => {
    const { user, showChangePasswordModal, closeChangePasswordModal, updateUserCredentials } = useAuth();
    const [status, setStatus] = useState(null);
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [backupLoading, setBackupLoading] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [toast, setToast] = useState(null);
    const [confirmAction, setConfirmAction] = useState(null);
    const [pitrStatus, setPitrStatus] = useState(null);
    const [pitrLoading, setPitrLoading] = useState(true);

    // Pagination state for backup history
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);

    // Restore modal state
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [restoreBackupData, setRestoreBackupData] = useState(null);
    const [restoring, setRestoring] = useState(false);

    // Schedule confirmation modal state
    const [showScheduleConfirm, setShowScheduleConfirm] = useState(false);
    const [scheduleLoading, setScheduleLoading] = useState(false);

    // Delete confirmation modal state
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteBackupData, setDeleteBackupData] = useState(null);
    const [deleting, setDeleting] = useState(false);

    // Date filter state for backup history
    const [dateFilter, setDateFilter] = useState('all'); // 'all', 'today', 'yesterday', or 'YYYY-MM-DD'

    const fetchStatus = async () => {
        try {
            const response = await api.get('/backup/status');
            if (response.data.success) {
                setStatus(response.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch status:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchBackups = async () => {
        try {
            const response = await api.get('/backups');
            if (response.data.success) {
                setBackups(response.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch backups:', error);
        }
    };

    const fetchPitrStatus = async () => {
        try {
            const response = await api.get('/backup/pitr-status');
            if (response.data.success) {
                setPitrStatus(response.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch PITR status:', error);
        } finally {
            setPitrLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchBackups();
        fetchPitrStatus();

        const interval = setInterval(() => {
            fetchStatus();
            fetchBackups();
            fetchPitrStatus();
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const startBackup = async (type) => {
        setBackupLoading(true);
        setShowConfirm(false);

        try {
            const response = await api.post('/backup/run', { type, engine: 'all' });

            if (response.data.success) {
                setToast({
                    message: `${type} backup started successfully`,
                    type: 'success'
                });

                setTimeout(() => {
                    fetchStatus();
                    fetchBackups();
                }, 2000);
            }
        } catch (error) {
            setToast({
                message: error.response?.data?.message || 'Failed to start backup',
                type: 'error'
            });
        } finally {
            setBackupLoading(false);
        }
    };

    const toggleSchedule = async () => {
        if (!status?.schedule) return;

        const enabled = !status.schedule.enabled;

        // Show confirmation modal when starting schedule
        if (enabled) {
            setShowScheduleConfirm(true);
            return;
        }

        // Stop schedule directly
        await executeScheduleToggle(false);
    };

    const executeScheduleToggle = async (enabled) => {
        setScheduleLoading(true);
        setShowScheduleConfirm(false);

        try {
            const response = await api.post('/backup/schedule', {
                enabled
            });

            if (response.data.success) {
                setToast({
                    message: enabled
                        ? 'Schedule started! Backups will run automatically based on your settings.'
                        : 'Schedule stopped successfully',
                    type: 'success'
                });
                fetchStatus();
                fetchBackups();
            }
        } catch (error) {
            setToast({
                message: error.response?.data?.message || 'Failed to update schedule',
                type: 'error'
            });
        } finally {
            setScheduleLoading(false);
        }
    };

    const downloadBackup = async (backupId) => {
        try {
            const response = await api.get(`/backups/${backupId}/download`, {
                responseType: 'blob'
            });

            const backup = backups.find(b => b.id === backupId);
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', backup?.filename || `backup_${backupId}.tar.gz`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            setToast({
                message: 'Backup download started',
                type: 'success'
            });
        } catch (error) {
            setToast({
                message: 'Failed to download backup',
                type: 'error'
            });
        }
    };

    const restoreBackup = (backupId) => {
        const backup = backups.find(b => b.id === backupId);
        if (backup) {
            setRestoreBackupData(backup);
            setShowRestoreModal(true);
        }
    };

    const executeRestore = async () => {
        if (!restoreBackupData) return;

        setRestoring(true);
        setShowRestoreModal(false);

        setToast({ message: 'Restore in progress... Please wait.', type: 'info' });

        try {
            const response = await api.post(`/restore/${restoreBackupData.id}`);
            if (response.data.success) {
                setToast({
                    message: 'Database restored successfully!',
                    type: 'success'
                });
                fetchBackups();
            }
        } catch (error) {
            setToast({
                message: error.response?.data?.message || 'Restore failed',
                type: 'error'
            });
        } finally {
            setRestoring(false);
            setRestoreBackupData(null);
        }
    };

    const closeRestoreModal = () => {
        if (!restoring) {
            setShowRestoreModal(false);
            setRestoreBackupData(null);
        }
    };

    const handleDeleteClick = (backupId) => {
        const backup = backups.find(b => b.id === backupId);
        if (backup) {
            setDeleteBackupData(backup);
            setShowDeleteConfirm(true);
        }
    };

    const executeDelete = async () => {
        if (!deleteBackupData) return;

        setDeleting(true);

        try {
            const response = await api.delete(`/backups/${deleteBackupData.id}`);

            if (response.data.success) {
                setToast({
                    message: 'Backup deleted successfully',
                    type: 'success'
                });
                fetchBackups();
            }
        } catch (error) {
            setToast({
                message: 'Failed to delete backup',
                type: 'error'
            });
        } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
            setDeleteBackupData(null);
        }
    };

    const closeDeleteModal = () => {
        if (!deleting) {
            setShowDeleteConfirm(false);
            setDeleteBackupData(null);
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp).toLocaleString();
    };

    // Inspect Modal State
    const [inspectModalOpen, setInspectModalOpen] = useState(false);
    const [inspectData, setInspectData] = useState(null);
    const [inspectLoading, setInspectLoading] = useState(false);
    const [inspectError, setInspectError] = useState(null);
    const [inspectBackupId, setInspectBackupId] = useState(null);

    const handleInspect = async (backupId) => {
        setInspectBackupId(backupId);
        setInspectModalOpen(true);
        setInspectLoading(true);
        setInspectError(null);
        setInspectData(null);

        try {
            const response = await api.get(`/backups/${backupId}/inspect`);
            if (response.data.success) {
                setInspectData(response.data.data); // Assuming backend returns { success: true, data: { ... } } or similar.
                // Looking at other API calls in this file (e.g. fetchStatus), they check response.data.success.
                // The original code was waiting for response.json(). 
                // Let's check what inspect endpoint returns. The user didn't show inspect route code, but standard pattern here seems to be { success: true, data: ... }
                // Wait, I saw backup.js but it didn't have /inspect route. It might be in another file or I missed it?
                // Ah, I missed checking where /inspect route is defined. It wasn't in backup.js?
                // `3000/api/backups/backup_1765459546923_9p2g8983z/inspect`
                // Let me re-read backup.js carefully.
                // It was NOT in backup.js I read earlier.
                // Maybe it's in a different route or I missed a file.
                // However, the error is 401 (Unauthorized), so using `api` instance which adds the header is definitely the fix for 401.
                // Regarding the response structure: Dashboard.jsx uses `response.data.data` for other calls.
                // But let's look at the original code: `const data = await response.json(); setInspectData(data);`
                // If I use axios, `response.data` IS the json.
                // So if the backend returns just the data, I should set `response.data`.
                // If it returns `{ success: true, data: ... }`, I should set `response.data`.
                // But wait, the original code used `setInspectData(data)`.
                // I will use `setInspectData(response.data)` to be safe and close to original behavior, but usually these APIS wrap in success/data.
                // If I look at `fetchStatus`: `setStatus(response.data.data)`.
                // I will assume `response.data` is what we want, but if it is wrapped, I might need to unwrap it if the UI expects unwrapped data.
                // Let's stick to `api.get` and `setInspectData` with `response.data` for now, or match the pattern if I can.
                // Actually, if the previous code was `const data = await response.json()`, then `data` is the whole object.
                // So `response.data` in axios is equivalent to `await response.json()`.
            }

        } catch (error) {
            setInspectError(error.message);
        } finally {
            setInspectLoading(false);
        }
    };

    const closeInspectModal = () => {
        setInspectModalOpen(false);
        setInspectData(null);
        setInspectError(null);
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const getTotalBackupSize = () => {
        return backups.reduce((total, backup) => total + (backup.size || 0), 0);
    };

    const handleConfirmAction = (action, type) => {
        setConfirmAction({ action, type });
        setShowConfirm(true);
    };

    const executeConfirmAction = () => {
        if (confirmAction) {
            startBackup(confirmAction.type);
        }
    };

    // Date filter helper - get available dates from backups
    const getAvailableDates = () => {
        const dates = new Set();
        backups.forEach(backup => {
            if (backup.timestamp) {
                const date = new Date(backup.timestamp).toISOString().split('T')[0];
                dates.add(date);
            }
        });
        return Array.from(dates).sort().reverse(); // Most recent first
    };

    // Filter backups by date
    const getFilteredBackups = () => {
        if (dateFilter === 'all') {
            return backups;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        let filterDate;
        if (dateFilter === 'today') {
            filterDate = today;
        } else if (dateFilter === 'yesterday') {
            filterDate = yesterday;
        } else {
            // Specific date in YYYY-MM-DD format
            filterDate = new Date(dateFilter);
            filterDate.setHours(0, 0, 0, 0);
        }

        const nextDay = new Date(filterDate);
        nextDay.setDate(nextDay.getDate() + 1);

        return backups.filter(backup => {
            const backupDate = new Date(backup.timestamp);
            return backupDate >= filterDate && backupDate < nextDay;
        });
    };

    // Pagination helpers - now uses filtered backups
    const filteredBackups = getFilteredBackups();
    const totalPages = Math.ceil(filteredBackups.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentBackups = filteredBackups.slice(startIndex, endIndex);

    // Reset to page 1 when filter changes
    const handleDateFilterChange = (newFilter) => {
        setDateFilter(newFilter);
        setCurrentPage(1);
    };

    const goToPage = (page) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    const getPageNumbers = () => {
        const pages = [];
        const maxVisiblePages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
        }
        return pages;
    };

    if (loading) {
        return (
            <div className="min-h-screen">
                <Navbar />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="flex justify-center items-center py-20">
                        <div className="spinner"></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <Navbar />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fadeIn">
                <div className="mb-6 sm:mb-8">
                    <h1 className="text-2xl sm:text-4xl font-bold text-gradient mb-2">Dashboard</h1>
                    <p className="text-gray-600 text-sm sm:text-lg">Monitor and manage your MongoDB backups</p>
                </div>

                {/* Statistics Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
                    <div className="stat-card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-600">Total Backups</p>
                                <p className="text-3xl font-bold text-gray-900 mt-1">{backups.length}</p>
                            </div>
                            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
                                    <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-600">Total Size</p>
                                <p className="text-3xl font-bold text-gray-900 mt-1">{formatBytes(getTotalBackupSize())}</p>
                            </div>
                            <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-600">Schedule Status</p>
                                <div className="mt-2">
                                    <StatusBadge status={status?.schedule?.enabled ? 'enabled' : 'disabled'} />
                                </div>
                            </div>
                            <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div className="stat-card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-600">Last Backup</p>
                                <p className="text-sm font-bold text-gray-900 mt-1">
                                    {status?.lastBackup ? formatDate(status.lastBackup.timestamp).split(',')[0] : 'None'}
                                </p>
                            </div>
                            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
                    {/* Current Status */}
                    <Card title="Current Status">
                        {status?.currentBackup ? (
                            <div className="space-y-3">
                                <div className="flex items-center space-x-3">
                                    <div className="w-3 h-3 bg-primary-500 rounded-full animate-pulse-glow" />
                                    <span className="font-semibold text-gray-900 text-lg">
                                        Backup in progress...
                                    </span>
                                </div>
                                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border-2 border-blue-100">
                                    <p className="text-sm text-gray-700 mb-1">
                                        <strong>Type:</strong> {status.currentBackup.type}
                                    </p>
                                    <p className="text-sm text-gray-700">
                                        <strong>ID:</strong> <code className="bg-white px-2 py-0.5 rounded">{status.currentBackup.id}</code>
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-8">
                                <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" />
                                </svg>
                                <p className="text-gray-500 font-medium">No backup currently running</p>
                            </div>
                        )}
                    </Card>

                    {/* Quick Actions */}
                    <Card title="Quick Actions">
                        <div className="space-y-3">
                            <div className="group relative">
                                <button
                                    onClick={() => handleConfirmAction('full', 'full')}
                                    disabled={backupLoading || !!status?.currentBackup || status?.schedule?.enabled}
                                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-white font-medium transition-all duration-200 ${backupLoading || !!status?.currentBackup || status?.schedule?.enabled
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] shadow-md hover:shadow-lg'
                                        }`}
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                                    </svg>
                                    Start Full Backup
                                    {backups.length === 0 && !status?.schedule?.enabled && <span className="ml-2 bg-white text-emerald-600 text-xs px-2 py-0.5 rounded-full font-bold animate-pulse">Start Here</span>}
                                </button>
                                <p className="text-xs text-gray-500 mt-1 text-center">
                                    {status?.schedule?.enabled ? 'Disabled while schedule is running' : 'Creates a complete standard snapshot of the database.'}
                                </p>
                            </div>

                            <div className="group relative">
                                <button
                                    onClick={() => handleConfirmAction('incremental', 'incremental')}
                                    disabled={backupLoading || !!status?.currentBackup || backups.length === 0 || status?.schedule?.enabled}
                                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all duration-200 border-2 ${backupLoading || !!status?.currentBackup || backups.length === 0 || status?.schedule?.enabled
                                        ? 'border-gray-100 text-gray-400 cursor-not-allowed bg-gray-50'
                                        : 'border-emerald-100 text-gray-700 hover:border-emerald-500 hover:text-emerald-600 active:scale-[0.98] bg-white'
                                        }`}
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                    </svg>
                                    Start Incremental Backup
                                </button>
                                <p className="text-xs text-gray-500 mt-1 text-center">
                                    {status?.schedule?.enabled
                                        ? 'Disabled while schedule is running'
                                        : backups.length === 0
                                            ? "Requires a Full Backup first."
                                            : "Saves recent changes (Oplog Slice) since the last backup."}
                                </p>
                            </div>
                            <button
                                onClick={toggleSchedule}
                                disabled={scheduleLoading}
                                className={`w-full ${status?.schedule?.enabled ? 'btn-danger' : 'btn-primary'} flex items-center justify-center gap-2`}
                            >
                                {scheduleLoading ? (
                                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                    </svg>
                                )}
                                {scheduleLoading ? 'Processing...' : status?.schedule?.enabled ? 'Stop Schedule' : 'Start Schedule'}
                            </button>
                            <p className="text-xs text-gray-500 text-center mt-2">
                                {status?.currentBackup
                                    ? 'Backup in progress...'
                                    : status?.schedule?.enabled
                                        ? 'Schedule is running. Manual backups disabled.'
                                        : 'Manual backups run in the background'}
                            </p>
                        </div>
                    </Card>
                </div>

                {/* PITR Status Card */}
                <div className="mb-8">
                    <PITRStatusCard pitrStatus={pitrStatus} loading={pitrLoading} />
                </div>

                {/* Backup Schedule Info */}
                {
                    status?.schedule && (
                        <Card title="📅 Backup Schedule" className="mb-8">
                            <div className="space-y-4">
                                {/* Schedule Status Header with Timezone */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl p-4 border border-gray-200">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-3 h-3 rounded-full ${status.schedule.enabled ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                                        <span className="font-semibold text-gray-900">
                                            Schedule {status.schedule.enabled ? 'Active' : 'Disabled'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {status.schedule.timezone && (
                                            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                                                🌍 {status.schedule.timezone.name} ({status.schedule.timezone.abbreviation || status.schedule.timezone.offset})
                                            </span>
                                        )}
                                        <StatusBadge status={status.schedule.enabled ? 'enabled' : 'disabled'} />
                                    </div>
                                </div>

                                {/* Dual Schedule Display */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                    {/* Full Backup Schedule */}
                                    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl p-5 border-2 border-purple-200">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center">
                                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                                                </svg>
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-900">Full Backup</h4>
                                                <p className="text-xs text-gray-500">Complete database snapshot</p>
                                            </div>
                                        </div>
                                        <div className="bg-white rounded-lg p-3 border border-purple-100">
                                            <p className="text-sm text-gray-500 mb-1">Schedule:</p>
                                            <p className="text-lg font-bold text-purple-700">
                                                {status.schedule.fullBackupDescription || status.schedule.fullBackupCron || 'Not configured'}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <code className="text-xs text-gray-400 font-mono">{status.schedule.fullBackupCron}</code>
                                                {status.schedule.timezone && (
                                                    <span className="text-xs text-gray-400">({status.schedule.timezone.abbreviation || status.schedule.timezone.offset})</span>
                                                )}
                                            </div>
                                            {status.schedule.nextFullBackup && status.schedule.enabled && (
                                                <p className="text-xs text-purple-600 mt-2">
                                                    Next: {new Date(status.schedule.nextFullBackup.iso).toLocaleString()}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Incremental Backup Schedule */}
                                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 border-2 border-green-200">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                                </svg>
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-900">Incremental Backup</h4>
                                                <p className="text-xs text-gray-500">Changes since last backup</p>
                                            </div>
                                        </div>
                                        <div className="bg-white rounded-lg p-3 border border-green-100">
                                            <p className="text-sm text-gray-500 mb-1">Schedule:</p>
                                            <p className="text-lg font-bold text-green-700">
                                                {status.schedule.incrementalBackupDescription || status.schedule.incrementalBackupCron || 'Not configured'}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <code className="text-xs text-gray-400 font-mono">{status.schedule.incrementalBackupCron}</code>
                                                {status.schedule.timezone && (
                                                    <span className="text-xs text-gray-400">({status.schedule.timezone.abbreviation || status.schedule.timezone.offset})</span>
                                                )}
                                            </div>
                                            {status.schedule.nextIncrementalBackup && status.schedule.enabled && (
                                                <p className="text-xs text-green-600 mt-2">
                                                    Next: {new Date(status.schedule.nextIncrementalBackup.iso).toLocaleString()}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Next Run Info - Enhanced */}
                                {status.schedule.nextRun && (
                                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
                                        <div className="flex items-center gap-3">
                                            <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <div className="flex-1">
                                                <p className="text-sm text-gray-600">Next scheduled backup:</p>
                                                <p className="font-bold text-amber-700">{formatDate(status.schedule.nextRun)}</p>
                                            </div>
                                            {status.schedule.timezone && (
                                                <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded-full">
                                                    {status.schedule.timezone.abbreviation || status.schedule.timezone.offset}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Card>
                    )
                }

                {/* Backup History */}
                <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-1">Backup History</h2>
                        <p className="text-gray-600 text-sm">
                            {dateFilter === 'all'
                                ? `All ${backups.length} backups`
                                : `${filteredBackups.length} backup${filteredBackups.length !== 1 ? 's' : ''} for ${dateFilter === 'today' ? 'today' : dateFilter === 'yesterday' ? 'yesterday' : new Date(dateFilter).toLocaleDateString()}`
                            }
                        </p>
                    </div>

                    {/* Date Filter */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-500">Filter by date:</span>
                        <div className="flex flex-wrap gap-1">
                            <button
                                onClick={() => handleDateFilterChange('all')}
                                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${dateFilter === 'all'
                                    ? 'bg-emerald-500 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => handleDateFilterChange('today')}
                                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${dateFilter === 'today'
                                    ? 'bg-emerald-500 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                Today
                            </button>
                            <button
                                onClick={() => handleDateFilterChange('yesterday')}
                                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${dateFilter === 'yesterday'
                                    ? 'bg-emerald-500 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                Yesterday
                            </button>

                            {/* Date Picker Dropdown */}
                            <select
                                value={dateFilter}
                                onChange={(e) => handleDateFilterChange(e.target.value)}
                                className="px-3 py-1.5 text-sm rounded-lg font-medium bg-white border border-gray-200 text-gray-600 hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                            >
                                <option value="all">Select Date</option>
                                {getAvailableDates().map(date => (
                                    <option key={date} value={date}>
                                        {new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
                                            weekday: 'short',
                                            month: 'short',
                                            day: 'numeric'
                                        })}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {
                    backups.length === 0 ? (
                        <Card>
                            <div className="text-center py-12">
                                <svg className="w-20 h-20 mx-auto text-gray-300 mb-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                </svg>
                                <h3 className="text-xl font-semibold text-gray-700 mb-2">No backups yet</h3>
                                <p className="text-gray-500 mb-4">Start your first backup to see it here</p>
                            </div>
                        </Card>
                    ) : (
                        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                            {/* Desktop Table - Hidden on mobile */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                                        <tr>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Type</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Backup ID</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Size</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Date</th>
                                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Storage</th>
                                            <th className="px-6 py-4 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {currentBackups.map((backup, index) => (
                                            <tr
                                                key={backup.id}
                                                className={`hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 transition-all duration-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow-md ${backup.type === 'full'
                                                        ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
                                                        : 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                                        }`}>
                                                        {backup.type}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow-md ${backup.status === 'completed'
                                                        ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                                                        : backup.status === 'failed'
                                                            ? 'bg-gradient-to-r from-red-500 to-rose-500'
                                                            : backup.status === 'running'
                                                                ? 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                                                : 'bg-gradient-to-r from-gray-400 to-gray-500'
                                                        }`}>
                                                        {backup.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-sm font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">
                                                        {backup.id.length > 30 ? `${backup.id.substring(0, 30)}...` : backup.id}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className="text-sm font-semibold text-gray-900">{formatBytes(backup.size)}</span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className="text-sm text-gray-700">{formatDate(backup.timestamp)}</span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {backup.ftp_path ? (
                                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                                            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                                                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                                            </svg>
                                                            FTP
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                                            Local
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex items-center justify-center gap-2">
                                                        {(backup.local_path || backup.ftp_path) && (
                                                            <button
                                                                onClick={() => downloadBackup(backup.id)}
                                                                className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors duration-200"
                                                                title="Download"
                                                            >
                                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                                </svg>
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleInspect(backup.id)}
                                                            className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors duration-200"
                                                            title="Inspect"
                                                        >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => restoreBackup(backup.id)}
                                                            className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors duration-200"
                                                            title="Restore"
                                                        >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteClick(backup.id)}
                                                            className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors duration-200"
                                                            title="Delete"
                                                        >
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Mobile Card View - Shown only on mobile */}
                            <div className="md:hidden divide-y divide-gray-100">
                                {currentBackups.map((backup) => (
                                    <div key={backup.id} className="p-4 hover:bg-gray-50 transition-colors">
                                        {/* Header Row: Type, Status, Storage */}
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold text-white shadow-sm ${backup.type === 'full'
                                                    ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
                                                    : 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                                    }`}>
                                                    {backup.type}
                                                </span>
                                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold text-white shadow-sm ${backup.status === 'completed'
                                                    ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                                                    : backup.status === 'failed'
                                                        ? 'bg-gradient-to-r from-red-500 to-rose-500'
                                                        : backup.status === 'running'
                                                            ? 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                                            : 'bg-gradient-to-r from-gray-400 to-gray-500'
                                                    }`}>
                                                    {backup.status}
                                                </span>
                                            </div>
                                            {backup.ftp_path ? (
                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                                    FTP
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                                    Local
                                                </span>
                                            )}
                                        </div>

                                        {/* Details Row */}
                                        <div className="space-y-1.5 mb-3">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-500">Size:</span>
                                                <span className="font-semibold text-gray-900">{formatBytes(backup.size)}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-500">Date:</span>
                                                <span className="text-gray-700">{formatDate(backup.timestamp)}</span>
                                            </div>
                                            <div className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1 rounded truncate">
                                                {backup.id}
                                            </div>
                                        </div>

                                        {/* Action Buttons - Touch-friendly */}
                                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                                            {(backup.local_path || backup.ftp_path) && (
                                                <button
                                                    onClick={() => downloadBackup(backup.id)}
                                                    className="flex-1 flex items-center justify-center gap-1 py-2 px-3 text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors text-sm font-medium"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                    </svg>
                                                    <span className="hidden xs:inline">Download</span>
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleInspect(backup.id)}
                                                className="flex-1 flex items-center justify-center gap-1 py-2 px-3 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors text-sm font-medium"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                                <span className="hidden xs:inline">Inspect</span>
                                            </button>
                                            <button
                                                onClick={() => restoreBackup(backup.id)}
                                                className="flex-1 flex items-center justify-center gap-1 py-2 px-3 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors text-sm font-medium"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                                <span className="hidden xs:inline">Restore</span>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteClick(backup.id)}
                                                className="flex-1 flex items-center justify-center gap-1 py-2 px-3 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors text-sm font-medium"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                                <span className="hidden xs:inline">Delete</span>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-t border-gray-200">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm text-gray-600">
                                            Showing <span className="font-semibold text-gray-900">{startIndex + 1}</span> to{' '}
                                            <span className="font-semibold text-gray-900">{Math.min(endIndex, backups.length)}</span> of{' '}
                                            <span className="font-semibold text-gray-900">{backups.length}</span> backups
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => goToPage(1)}
                                                disabled={currentPage === 1}
                                                className="p-2 text-gray-600 hover:bg-white hover:text-gray-900 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="First Page"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => goToPage(currentPage - 1)}
                                                disabled={currentPage === 1}
                                                className="p-2 text-gray-600 hover:bg-white hover:text-gray-900 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Previous Page"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                                </svg>
                                            </button>

                                            <div className="flex items-center gap-1">
                                                {getPageNumbers().map((page) => (
                                                    <button
                                                        key={page}
                                                        onClick={() => goToPage(page)}
                                                        className={`px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 ${currentPage === page
                                                            ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md'
                                                            : 'text-gray-600 hover:bg-white hover:text-gray-900'
                                                            }`}
                                                    >
                                                        {page}
                                                    </button>
                                                ))}
                                            </div>

                                            <button
                                                onClick={() => goToPage(currentPage + 1)}
                                                disabled={currentPage === totalPages}
                                                className="p-2 text-gray-600 hover:bg-white hover:text-gray-900 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Next Page"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => goToPage(totalPages)}
                                                disabled={currentPage === totalPages}
                                                className="p-2 text-gray-600 hover:bg-white hover:text-gray-900 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Last Page"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                }
            </div>

            {/* Inspect Modal */}
            <BackupInspectionModal
                isOpen={inspectModalOpen}
                onClose={closeInspectModal}
                backupId={inspectBackupId}
                data={inspectData}
                loading={inspectLoading}
                error={inspectError}
            />

            {/* Confirmation Modal */}
            <Modal
                isOpen={showConfirm}
                onClose={() => setShowConfirm(false)}
                title="Confirm Backup"
                footer={
                    <>
                        <button
                            onClick={() => setShowConfirm(false)}
                            className="btn-secondary"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={executeConfirmAction}
                            className="btn-primary"
                        >
                            Start Backup
                        </button>
                    </>
                }
            >
                <p className="text-gray-700">
                    Are you sure you want to start a {confirmAction?.type} backup?
                    This process may take several minutes depending on your database size.
                </p>
            </Modal>

            {/* Restore Confirmation Modal */}
            <Modal
                isOpen={showRestoreModal}
                onClose={closeRestoreModal}
                title="🔄 Restore Backup"
                footer={
                    <>
                        <button
                            onClick={closeRestoreModal}
                            className="btn-secondary"
                            disabled={restoring}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={executeRestore}
                            className="btn-danger flex items-center gap-2"
                            disabled={restoring}
                        >
                            {restoring ? (
                                <>
                                    <div className="spinner-sm"></div>
                                    Restoring...
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Confirm Restore
                                </>
                            )}
                        </button>
                    </>
                }
            >
                {restoreBackupData && (
                    <div className="space-y-5">
                        {/* Backup Info Card */}
                        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-5 border border-indigo-100">
                            <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                                </svg>
                                Backup Details
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Type</p>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow-md ${restoreBackupData.type === 'full'
                                        ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
                                        : 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                        }`}>
                                        {restoreBackupData.type}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Status</p>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow-md ${restoreBackupData.status === 'completed'
                                        ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                                        : 'bg-gradient-to-r from-gray-400 to-gray-500'
                                        }`}>
                                        {restoreBackupData.status}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Size</p>
                                    <p className="text-sm font-semibold text-gray-900">{formatBytes(restoreBackupData.size)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Created</p>
                                    <p className="text-sm font-semibold text-gray-900">{formatDate(restoreBackupData.timestamp)}</p>
                                </div>
                            </div>
                            <div className="mt-4 pt-3 border-t border-indigo-200">
                                <p className="text-xs text-gray-500 mb-1">Backup ID</p>
                                <p className="text-xs font-mono text-gray-700 bg-white px-2 py-1 rounded">{restoreBackupData.id}</p>
                            </div>
                        </div>

                        {/* What will happen */}
                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                            <h4 className="text-sm font-semibold text-gray-700 mb-3">What will happen?</h4>
                            <ul className="space-y-2 text-sm text-gray-600">
                                <li className="flex items-start gap-2">
                                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>Your current database will be replaced with this backup</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>This may take a few minutes depending on backup size</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>All data will be restored from {formatDate(restoreBackupData.timestamp).split(',')[0]}</span>
                                </li>
                            </ul>
                        </div>

                        {/* Warning */}
                        <div className="bg-red-50 rounded-xl p-4 border-2 border-red-200">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div>
                                    <h4 className="font-bold text-red-700">⚠️ Critical Warning</h4>
                                    <p className="text-sm text-red-600 mt-1">
                                        This action will <strong>permanently overwrite</strong> your current database.
                                        Any data added after this backup was created will be <strong>lost forever</strong>.
                                        This cannot be undone!
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Modal >

            {/* Toast Notifications */}
            {
                toast && (
                    <div className="fixed bottom-4 right-4 z-50">
                        <Toast
                            message={toast.message}
                            type={toast.type}
                            onClose={() => setToast(null)}
                        />
                    </div>
                )
            }

            {/* First Login Change Password Modal */}
            <ChangePasswordModal
                isOpen={showChangePasswordModal}
                onClose={closeChangePasswordModal}
                onSuccess={(newUsername) => {
                    updateUserCredentials(newUsername);
                    setToast({ message: 'Credentials updated successfully!', type: 'success' });
                }}
                currentUsername={user?.username || 'admin'}
                isFirstLogin={user?.isFirstLogin}
            />

            {/* Schedule Confirmation Modal */}
            {showScheduleConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowScheduleConfirm(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-fadeIn">
                        {/* Header */}
                        <div className="bg-gradient-to-r from-emerald-500 to-green-600 px-6 py-5">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-white">Start Automated Backups</h2>
                                    <p className="text-emerald-100 text-sm">Enable scheduled backup protection</p>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-4">
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                                <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                                    <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    Your Schedule Settings
                                </h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-white rounded-lg p-3 border border-blue-100">
                                        <p className="text-xs text-gray-500 mb-1">Full Backup</p>
                                        <p className="font-bold text-purple-600 text-sm">
                                            {status?.schedule?.fullBackupCron === '0 2 * * *' ? 'Daily at 2 AM' :
                                                status?.schedule?.fullBackupCron === '0 0 * * *' ? 'Daily at Midnight' :
                                                    status?.schedule?.fullBackupCron || 'Daily at 2 AM'}
                                        </p>
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-blue-100">
                                        <p className="text-xs text-gray-500 mb-1">Incremental Backup</p>
                                        <p className="font-bold text-green-600 text-sm">
                                            {status?.schedule?.incrementalBackupCron === '* * * * *' ? 'Every 1 Minute' :
                                                status?.schedule?.incrementalBackupCron === '*/5 * * * *' ? 'Every 5 Minutes' :
                                                    status?.schedule?.incrementalBackupCron === '*/15 * * * *' ? 'Every 15 Minutes' :
                                                        status?.schedule?.incrementalBackupCron || 'Every 15 Minutes'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {backups.length === 0 && (
                                <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                                    <div className="flex items-start gap-3">
                                        <svg className="w-6 h-6 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                        <div>
                                            <h4 className="font-semibold text-amber-700">Initial Backup Required</h4>
                                            <p className="text-sm text-amber-600 mt-1">
                                                No backups exist yet. An initial <strong>full backup</strong> will be created automatically when you start the schedule.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                <h4 className="font-semibold text-gray-800 mb-2">When you start the schedule:</h4>
                                <ul className="space-y-2 text-sm text-gray-600">
                                    <li className="flex items-center gap-2">
                                        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                        Full backups run based on your schedule
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                        Incremental backups capture changes frequently
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                        Manual backup buttons will be disabled
                                    </li>
                                </ul>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-gray-50 border-t flex gap-3 justify-end">
                            <button
                                onClick={() => setShowScheduleConfirm(false)}
                                className="px-5 py-2.5 text-gray-700 bg-white border-2 border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => executeScheduleToggle(true)}
                                disabled={scheduleLoading}
                                className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all font-medium flex items-center gap-2 shadow-lg"
                            >
                                {scheduleLoading ? (
                                    <>
                                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Starting...
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Start Schedule
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && deleteBackupData && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
                        {/* Header with danger gradient */}
                        <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-5">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur">
                                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white">Delete Backup</h3>
                                    <p className="text-red-100 text-sm">This action cannot be undone</p>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6">
                            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 mb-4">
                                <div className="flex items-start gap-3">
                                    <svg className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <div>
                                        <p className="text-sm text-red-800 font-semibold mb-1">Warning</p>
                                        <p className="text-sm text-red-700">You are about to permanently delete this backup. This will remove the backup file and all associated data.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Backup ID:</span>
                                    <code className="text-gray-900 font-mono text-xs bg-white px-2 py-0.5 rounded">{deleteBackupData.id}</code>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Type:</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold text-white ${deleteBackupData.type === 'full'
                                            ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
                                            : 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                        }`}>{deleteBackupData.type}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Size:</span>
                                    <span className="font-semibold text-gray-900">{formatBytes(deleteBackupData.size)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-500">Created:</span>
                                    <span className="text-gray-900">{formatDate(deleteBackupData.timestamp)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-gray-50 border-t flex gap-3 justify-end">
                            <button
                                onClick={closeDeleteModal}
                                disabled={deleting}
                                className="px-5 py-2.5 text-gray-700 bg-white border-2 border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all font-medium disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeDelete}
                                disabled={deleting}
                                className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl hover:from-red-600 hover:to-rose-700 transition-all font-medium flex items-center gap-2 shadow-lg disabled:opacity-70"
                            >
                                {deleting ? (
                                    <>
                                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Deleting...
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                        Delete Backup
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;

