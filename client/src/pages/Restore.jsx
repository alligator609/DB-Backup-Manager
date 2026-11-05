import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import Card from '../components/Card';
import Toast from '../components/Toast';
import Modal from '../components/Modal';
import api from '../utils/api';

const Restore = () => {
    // Tab state
    const [activeTab, setActiveTab] = useState('backups');

    // Backups state
    const [backups, setBackups] = useState([]);
    const [backupsLoading, setBackupsLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(5);

    // Restore state
    const [selectedBackup, setSelectedBackup] = useState(null);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [restoring, setRestoring] = useState(false);

    // Upload state
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);

    // PITR State
    const [pitrStatus, setPitrStatus] = useState(null);
    const [pitrLoading, setPitrLoading] = useState(true);
    const [selectedTime, setSelectedTime] = useState('');
    const [restoreChain, setRestoreChain] = useState(null);
    const [chainLoading, setChainLoading] = useState(false);
    const [showPitrModal, setShowPitrModal] = useState(false);

    // Toast
    const [toast, setToast] = useState(null);

    // Fetch data on mount
    useEffect(() => {
        fetchBackups();
        fetchPitrStatus();
    }, []);

    const fetchBackups = async () => {
        try {
            const response = await api.get('/backups');
            if (response.data.success) {
                // Filter only completed backups
                const completedBackups = response.data.data.filter(b => b.status === 'completed');
                setBackups(completedBackups);
            }
        } catch (error) {
            console.error('Failed to fetch backups:', error);
        } finally {
            setBackupsLoading(false);
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

    // Pagination
    const totalPages = Math.ceil(backups.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentBackups = backups.slice(startIndex, endIndex);

    const goToPage = (page) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
        }
    };

    // Restore from backup
    const handleSelectBackup = (backup) => {
        setSelectedBackup(backup);
        setShowRestoreModal(true);
    };

    const executeRestore = async () => {
        if (!selectedBackup) return;

        setRestoring(true);
        setShowRestoreModal(false);
        setToast({ message: 'Restore in progress... This may take a few minutes.', type: 'info' });

        try {
            const response = await api.post(`/restore/${selectedBackup.id}`);
            if (response.data.success) {
                setToast({
                    message: '✅ Database restored successfully!',
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
            setSelectedBackup(null);
        }
    };

    // PITR handlers
    const handleTimeChange = async (e) => {
        const time = e.target.value;
        setSelectedTime(time);

        if (!time) {
            setRestoreChain(null);
            return;
        }

        setChainLoading(true);
        try {
            const response = await api.get(`/restore/preview/${time}`);
            if (response.data.success) {
                setRestoreChain(response.data.data);
            }
        } catch (error) {
            setToast({
                message: error.response?.data?.message || 'Failed to calculate restore chain',
                type: 'error'
            });
            setRestoreChain(null);
        } finally {
            setChainLoading(false);
        }
    };

    const executePitrRestore = async () => {
        if (!selectedTime) return;

        setRestoring(true);
        setShowPitrModal(false);
        setToast({ message: 'Point-in-Time restore in progress...', type: 'info' });

        try {
            const response = await api.post('/restore/point-in-time', {
                timestamp: selectedTime
            });

            if (response.data.success) {
                setToast({
                    message: `✅ Restored to ${new Date(selectedTime).toLocaleString()}`,
                    type: 'success'
                });
                setSelectedTime('');
                setRestoreChain(null);
            }
        } catch (error) {
            setToast({
                message: error.response?.data?.message || 'PITR restore failed',
                type: 'error'
            });
        } finally {
            setRestoring(false);
        }
    };

    // Upload handlers
    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleUploadRestore = async () => {
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('backup', file);

        try {
            const response = await api.post('/restore/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (response.data.success) {
                setToast({
                    message: '✅ Backup restored successfully!',
                    type: 'success'
                });
                setFile(null);
            }
        } catch (error) {
            setToast({
                message: error.response?.data?.message || 'Restore failed',
                type: 'error'
            });
        } finally {
            setUploading(false);
        }
    };

    // Helpers
    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp).toLocaleString();
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const getMinTime = () => {
        if (!pitrStatus?.coverage?.start) return '';
        return new Date(pitrStatus.coverage.start).toISOString().slice(0, 16);
    };

    const getMaxTime = () => {
        if (!pitrStatus?.coverage?.end) return '';
        return new Date(pitrStatus.coverage.end).toISOString().slice(0, 16);
    };

    return (
        <div className="min-h-screen">
            <Navbar />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fadeIn">
                <div className="mb-6 sm:mb-8">
                    <h1 className="text-2xl sm:text-4xl font-bold text-gradient mb-2">Restore Database</h1>
                    <p className="text-gray-600 text-sm sm:text-lg">Choose how you want to restore your MongoDB database</p>
                </div>

                {/* Tab Navigation */}
                <div className="flex flex-wrap gap-2 mb-6 bg-white rounded-xl p-1.5 shadow-lg border border-gray-100">
                    <button
                        onClick={() => setActiveTab('backups')}
                        className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 text-sm sm:text-base ${activeTab === 'backups'
                            ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md'
                            : 'text-gray-600 hover:bg-gray-100'
                            }`}
                    >
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                        </svg>
                        <span className="hidden sm:inline">From Existing Backup</span>
                        <span className="sm:hidden">Backup</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('pitr')}
                        className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 text-sm sm:text-base ${activeTab === 'pitr'
                            ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md'
                            : 'text-gray-600 hover:bg-gray-100'
                            }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Point-in-Time
                    </button>
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 text-sm sm:text-base ${activeTab === 'upload'
                            ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md'
                            : 'text-gray-600 hover:bg-gray-100'
                            }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        Upload File
                    </button>
                </div>

                {/* TAB: Restore from Existing Backups */}
                {activeTab === 'backups' && (
                    <div className="space-y-6">
                        {/* Info Banner */}
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100 flex items-start gap-3">
                            <svg className="w-6 h-6 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div>
                                <h3 className="font-semibold text-blue-900">How it works</h3>
                                <p className="text-sm text-blue-700 mt-1">
                                    Select any completed backup from the list below and click "Restore" to replace your current database with that backup.
                                    Full backups restore the entire database state. Incremental backups contain only changes since the last backup.
                                </p>
                            </div>
                        </div>

                        {/* Backups Table */}
                        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                            <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                    <svg className="w-5 h-5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                                    </svg>
                                    Available Backups ({backups.length})
                                </h3>
                            </div>

                            {backupsLoading ? (
                                <div className="flex justify-center items-center py-12">
                                    <div className="spinner"></div>
                                </div>
                            ) : backups.length === 0 ? (
                                <div className="text-center py-12">
                                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                    </svg>
                                    <h3 className="text-lg font-semibold text-gray-700 mb-2">No backups available</h3>
                                    <p className="text-gray-500">Create a backup first from the Dashboard</p>
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead className="bg-gray-50 border-b border-gray-200">
                                                <tr>
                                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Type</th>
                                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Backup ID</th>
                                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Database</th>
                                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Size</th>
                                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Created</th>
                                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Storage</th>
                                                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Action</th>
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
                                                        <td className="px-6 py-4">
                                                            <span className="text-sm font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">
                                                                {backup.id.length > 28 ? `${backup.id.substring(0, 28)}...` : backup.id}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <div className="flex flex-col">
                                                                <span className={`inline-flex items-center gap-1 text-xs font-bold ${(backup.engine || 'mongodb') === 'mysql' ? 'text-sky-700' : 'text-green-700'}`}>
                                                                    {(backup.engine || 'mongodb') === 'mysql' ? '🐬 MySQL' : '🍃 MongoDB'}
                                                                </span>
                                                                <span className="text-xs text-gray-500">{backup.db_name || '-'}</span>
                                                            </div>
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
                                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                                            <button
                                                                onClick={() => handleSelectBackup(backup)}
                                                                disabled={restoring}
                                                                className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-lg shadow-md hover:shadow-lg hover:from-emerald-600 hover:to-green-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                                </svg>
                                                                Restore
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Pagination */}
                                    {totalPages > 1 && (
                                        <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-t border-gray-200">
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm text-gray-600">
                                                    Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                                                    <span className="font-semibold">{Math.min(endIndex, backups.length)}</span> of{' '}
                                                    <span className="font-semibold">{backups.length}</span> backups
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => goToPage(currentPage - 1)}
                                                        disabled={currentPage === 1}
                                                        className="p-2 text-gray-600 hover:bg-white hover:text-gray-900 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                                        </svg>
                                                    </button>
                                                    <span className="px-3 py-1 bg-white rounded text-sm font-medium">
                                                        Page {currentPage} of {totalPages}
                                                    </span>
                                                    <button
                                                        onClick={() => goToPage(currentPage + 1)}
                                                        disabled={currentPage === totalPages}
                                                        className="p-2 text-gray-600 hover:bg-white hover:text-gray-900 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Incremental Backup Explanation */}
                        <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-200">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                                <div>
                                    <h4 className="font-semibold text-amber-800">About Incremental Backups</h4>
                                    <p className="text-sm text-amber-700 mt-1">
                                        Incremental backups contain only the changes (oplog) since the previous backup.
                                        When restoring an incremental backup, the system automatically applies it on top of the most recent full backup.
                                        For precise point-in-time recovery, use the "Point-in-Time" tab.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB: Point-in-Time Recovery */}
                {activeTab === 'pitr' && (
                    <div className="space-y-6">
                        {/* Info Banner */}
                        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-4 border border-purple-100 flex items-start gap-3">
                            <svg className="w-6 h-6 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div>
                                <h3 className="font-semibold text-purple-900">Point-in-Time Recovery (PITR)</h3>
                                <p className="text-sm text-purple-700 mt-1">
                                    Restore your database to any specific moment in time within the recovery window.
                                    This uses a combination of full backups and incremental oplog entries to reconstruct the exact database state at your chosen time.
                                </p>
                            </div>
                        </div>

                        <Card>
                            {pitrLoading ? (
                                <div className="flex justify-center items-center py-12">
                                    <div className="spinner"></div>
                                </div>
                            ) : !pitrStatus?.enabled ? (
                                <div className="text-center py-12">
                                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <h3 className="text-lg font-semibold text-gray-700 mb-2">PITR Not Available</h3>
                                    <p className="text-gray-500 mb-4">Create a full backup and at least one incremental backup to enable PITR</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Recovery Window Display */}
                                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 border border-indigo-100">
                                        <h4 className="text-sm font-semibold text-gray-700 mb-4">Recovery Window</h4>
                                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                                            <div className="text-center">
                                                <p className="text-xs text-gray-500 mb-1">From</p>
                                                <p className="text-sm font-bold text-indigo-700 bg-white px-3 py-2 rounded-lg shadow-sm">
                                                    {formatDate(pitrStatus.coverage?.start)}
                                                </p>
                                            </div>
                                            <div className="flex-1 relative">
                                                <div className="h-2 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full"></div>
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 py-1 rounded-full text-xs font-medium text-gray-600 shadow">
                                                    {pitrStatus.coverage?.duration || 'Available'}
                                                </div>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-gray-500 mb-1">To</p>
                                                <p className="text-sm font-bold text-purple-700 bg-white px-3 py-2 rounded-lg shadow-sm">
                                                    {formatDate(pitrStatus.coverage?.end)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Time Selector */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Select Target Date & Time
                                        </label>
                                        <input
                                            type="datetime-local"
                                            value={selectedTime}
                                            onChange={handleTimeChange}
                                            min={getMinTime()}
                                            max={getMaxTime()}
                                            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:ring-0 transition-colors text-lg"
                                        />
                                        <p className="text-xs text-gray-500 mt-2">
                                            Choose a date and time within the recovery window above
                                        </p>
                                    </div>

                                    {/* Chain Preview */}
                                    {chainLoading ? (
                                        <div className="flex justify-center py-4">
                                            <div className="spinner"></div>
                                        </div>
                                    ) : restoreChain && (
                                        <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                                            <h4 className="text-sm font-semibold text-gray-700 mb-3">Restore Plan</h4>
                                            <div className="space-y-2 mb-4">
                                                {restoreChain.chain.map((backup, index) => (
                                                    <div key={backup.id} className="flex items-center gap-3 bg-white p-2 rounded-lg border">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${backup.type === 'full' ? 'bg-green-500' : 'bg-blue-500'
                                                            }`}>
                                                            {index + 1}
                                                        </div>
                                                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${backup.type === 'full' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                                            }`}>
                                                            {backup.type}
                                                        </span>
                                                        <span className="text-sm text-gray-600 flex-1 truncate">{backup.filename}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex justify-between text-sm border-t pt-3">
                                                <span className="text-gray-500">Estimated restore size:</span>
                                                <span className="font-semibold">{formatBytes(restoreChain.estimatedRestoreSize)}</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Restore Button */}
                                    <button
                                        onClick={() => setShowPitrModal(true)}
                                        disabled={!selectedTime || !restoreChain || restoring}
                                        className={`w-full btn-primary py-4 text-lg ${(!selectedTime || !restoreChain || restoring) ? 'opacity-50 cursor-not-allowed' : ''
                                            }`}
                                    >
                                        {restoring ? 'Restoring...' : 'Restore to Selected Time'}
                                    </button>
                                </div>
                            )}
                        </Card>
                    </div>
                )}

                {/* TAB: Upload File */}
                {activeTab === 'upload' && (
                    <div className="space-y-6">
                        {/* Info Banner */}
                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100 flex items-start gap-3">
                            <svg className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                            <div>
                                <h3 className="font-semibold text-green-900">Upload Backup File</h3>
                                <p className="text-sm text-green-700 mt-1">
                                    Upload a backup archive file (.gz or .tar.gz) that was downloaded or created externally.
                                    The system will automatically extract and restore the database from the uploaded file.
                                </p>
                            </div>
                        </div>

                        <Card>
                            <div
                                className={`border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 ${dragActive
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
                                    }`}
                                onDragEnter={handleDrag}
                                onDragLeave={handleDrag}
                                onDragOver={handleDrag}
                                onDrop={handleDrop}
                            >
                                <input
                                    type="file"
                                    id="file-upload"
                                    className="hidden"
                                    onChange={handleFileChange}
                                    accept=".gz,.tar.gz,.archive"
                                />

                                {!file ? (
                                    <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                                        <div className="w-16 h-16 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full flex items-center justify-center mb-4">
                                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                            </svg>
                                        </div>
                                        <span className="text-lg font-semibold text-gray-700 mb-1">
                                            Click to upload or drag and drop
                                        </span>
                                        <p className="text-sm text-gray-500">
                                            Supports .gz and .tar.gz backup files
                                        </p>
                                    </label>
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <div className="w-16 h-16 bg-gradient-to-r from-green-100 to-emerald-100 rounded-full flex items-center justify-center mb-4">
                                            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <p className="text-lg font-semibold text-gray-800 mb-1">{file.name}</p>
                                        <p className="text-sm text-gray-500 mb-6">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={handleUploadRestore}
                                                disabled={uploading}
                                                className={`btn-primary px-8 py-3 ${uploading ? 'opacity-70 cursor-not-allowed' : ''}`}
                                            >
                                                {uploading ? 'Restoring...' : 'Start Restore'}
                                            </button>
                                            <button
                                                onClick={() => setFile(null)}
                                                disabled={uploading}
                                                className="btn-secondary px-6 py-3"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>
                )}

                {/* Warning Card - Always visible */}
                <div className="mt-8">
                    <div className="bg-red-50 rounded-xl p-5 border-2 border-red-200 flex items-start gap-4">
                        <svg className="w-7 h-7 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div>
                            <h4 className="font-bold text-red-800 text-lg">⚠️ Critical Warning</h4>
                            <p className="text-sm text-red-700 mt-1">
                                Restoring a backup will <strong>permanently overwrite</strong> your current database.
                                All data created after the backup date will be <strong>lost forever</strong>.
                                Make sure you have a current backup before proceeding. This action cannot be undone!
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Restore Modal */}
            <Modal
                isOpen={showRestoreModal}
                onClose={() => !restoring && setShowRestoreModal(false)}
                title="🔄 Confirm Restore"
                footer={
                    <>
                        <button
                            onClick={() => setShowRestoreModal(false)}
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
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Restore Now
                        </button>
                    </>
                }
            >
                {selectedBackup && (
                    <div className="space-y-4">
                        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Type</p>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${selectedBackup.type === 'full'
                                        ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
                                        : 'bg-gradient-to-r from-blue-500 to-cyan-500'
                                        }`}>
                                        {selectedBackup.type}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Size</p>
                                    <p className="text-sm font-semibold text-gray-900">{formatBytes(selectedBackup.size)}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-xs text-gray-500 mb-1">Created</p>
                                    <p className="text-sm font-semibold text-gray-900">{formatDate(selectedBackup.timestamp)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-red-50 rounded-xl p-4 border-2 border-red-200">
                            <p className="text-sm text-red-700">
                                <strong>Warning:</strong> This will replace your current database with this backup.
                                All newer data will be permanently lost!
                            </p>
                        </div>
                    </div>
                )}
            </Modal>

            {/* PITR Confirmation Modal */}
            <Modal
                isOpen={showPitrModal}
                onClose={() => setShowPitrModal(false)}
                title="⏰ Confirm Point-in-Time Restore"
                footer={
                    <>
                        <button onClick={() => setShowPitrModal(false)} className="btn-secondary">
                            Cancel
                        </button>
                        <button onClick={executePitrRestore} className="btn-danger">
                            Confirm Restore
                        </button>
                    </>
                }
            >
                <div className="space-y-4">
                    <p className="text-gray-700">You are about to restore your database to:</p>
                    <div className="bg-indigo-50 p-4 rounded-lg text-center">
                        <p className="text-lg font-bold text-indigo-700">
                            {selectedTime && new Date(selectedTime).toLocaleString()}
                        </p>
                    </div>
                    {restoreChain && (
                        <p className="text-sm text-gray-600">
                            This will apply <strong>{restoreChain.chain.length}</strong> backup(s).
                        </p>
                    )}
                    <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                        <p className="text-sm text-red-700 font-medium">
                            ⚠️ This will overwrite your current database!
                        </p>
                    </div>
                </div>
            </Modal>

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-4 right-4 z-50">
                    <Toast
                        message={toast.message}
                        type={toast.type}
                        onClose={() => setToast(null)}
                    />
                </div>
            )}
        </div>
    );
};

export default Restore;
