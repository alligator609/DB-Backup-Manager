import React from 'react';

const BackupCard = ({ backup, onDownload, onDelete, onRestore, onInspect }) => {
    const formatDate = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const getTypeColor = (type) => {
        return type === 'full'
            ? 'bg-gradient-to-r from-purple-500 to-indigo-500'
            : 'bg-gradient-to-r from-blue-500 to-cyan-500';
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'completed':
                return 'bg-gradient-to-r from-green-500 to-emerald-500';
            case 'failed':
                return 'bg-gradient-to-r from-red-500 to-rose-500';
            case 'running':
                return 'bg-gradient-to-r from-blue-500 to-cyan-500';
            default:
                return 'bg-gradient-to-r from-gray-400 to-gray-500';
        }
    };

    // Engine badge (backups created before multi-engine support are MongoDB)
    const engineName = backup.engine || 'mongodb';
    const engineBadge = engineName === 'mysql'
        ? { icon: '🐬', label: 'MySQL', classes: 'bg-gradient-to-r from-sky-500 to-blue-600' }
        : { icon: '🍃', label: 'MongoDB', classes: 'bg-gradient-to-r from-green-500 to-emerald-600' };

    return (
        <div className="bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 border-2 border-gray-100 overflow-hidden group hover:scale-[1.02]">
            <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${getTypeColor(backup.type)} shadow-md`}>
                                {backup.type}
                            </span>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${getStatusColor(backup.status)} shadow-md`}>
                                {backup.status}
                            </span>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${engineBadge.classes} shadow-md`} title={`Database engine: ${engineBadge.label}`}>
                                {engineBadge.icon} {engineBadge.label}
                            </span>
                        </div>
                        <p className="text-sm text-gray-800 font-semibold mt-2">
                            {backup.db_name || 'unknown database'}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">
                            ID: {backup.id}
                        </p>
                    </div>

                    {backup.ftp_path && (
                        <div className="flex-shrink-0 ml-2">
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                </svg>
                                FTP
                            </span>
                        </div>
                    )}
                </div>

                <div className="space-y-3 mb-4">
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600 font-medium">Size</span>
                        <span className="text-sm font-bold text-gray-900">{formatBytes(backup.size)}</span>
                    </div>

                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600 font-medium">Date</span>
                        <span className="text-sm font-bold text-gray-900">{formatDate(backup.timestamp)}</span>
                    </div>

                    {backup.duration && (
                        <div className="flex items-center justify-between py-2 border-b border-gray-100">
                            <span className="text-sm text-gray-600 font-medium">Duration</span>
                            <span className="text-sm font-bold text-gray-900">{backup.duration}s</span>
                        </div>
                    )}
                </div>

                <div className="flex gap-2 mt-4">
                    {(backup.local_path || backup.ftp_path) && (
                        <button
                            onClick={() => onDownload(backup.id)}
                            className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                        </button>
                    )}

                    <button
                        onClick={() => onInspect(backup.id)}
                        className="flex-1 btn-secondary text-sm py-2 flex items-center justify-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 border-indigo-200"
                        title="View Contents"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        Inspect
                    </button>

                    <button
                        onClick={() => onRestore(backup.id)}
                        className="flex-1 btn-secondary text-sm py-2 flex items-center justify-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Restore
                    </button>

                    <button
                        onClick={() => onDelete(backup.id)}
                        className="px-4 py-2 text-sm font-semibold text-red-600 hover:text-white hover:bg-red-600 border-2 border-red-600 rounded-lg transition-all duration-200"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BackupCard;
