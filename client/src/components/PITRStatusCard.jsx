import React from 'react';

const ENGINE_META = {
    mongodb: {
        icon: '🍃',
        label: 'MongoDB',
        supportedText: (data) => `Replica Set: ${data.replicaSet?.setName || 'enabled'}`,
        unsupportedText: 'Standalone MongoDB (Limited Features)',
        requirementText: '⚠️ Incremental backups and PITR require MongoDB Replica Set.'
    },
    mysql: {
        icon: '🐬',
        label: 'MySQL',
        supportedText: () => 'Binary logging enabled',
        unsupportedText: 'Binary logging disabled (Limited Features)',
        requirementText: '⚠️ Incremental backups and PITR require binary logging (log_bin) on the MySQL server.'
    }
};

const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
};

const formatDuration = (start, end) => {
    if (!start || !end) return 'N/A';
    const durationMs = end - start;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

/**
 * PITRStatusCard - Displays Point-in-Time Recovery status per database engine
 */
const PITRStatusCard = ({ pitrStatus, loading }) => {
    if (loading) {
        return (
            <div className="card animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
        );
    }

    if (!pitrStatus) {
        return (
            <div className="card">
                <h3 className="text-lg font-semibold text-gray-700 mb-3">Point-in-Time Recovery</h3>
                <p className="text-gray-500">Unable to load PITR status</p>
            </div>
        );
    }

    const { stats } = pitrStatus;

    // Multi-engine response: { engines: { mongodb: {...}, mysql: {...} } }
    // Legacy/single-engine response: flat fields — wrap as one entry
    const engineEntries = pitrStatus.engines
        ? Object.entries(pitrStatus.engines)
        : [[pitrStatus.engine || 'mongodb', pitrStatus]];

    const anyEnabled = engineEntries.some(([, data]) => data.enabled);

    const renderEngineSection = (name, data) => {
        const meta = ENGINE_META[name] || { icon: '💾', label: name, supportedText: () => 'Enabled', unsupportedText: 'Disabled', requirementText: '⚠️ Incremental backups require a change log.' };
        const logSupported = data.incrementalSupport
            ? data.incrementalSupport.supported
            : data.replicaSet?.isReplicaSet;

        return (
            <div key={name} className="mb-4">
                {engineEntries.length > 1 && (
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                        {meta.icon} {meta.label}
                    </p>
                )}

                {/* Change-log Status (replica set / binlog) */}
                <div className={`p-3 rounded-lg ${logSupported
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-amber-50 border border-amber-200'
                    }`}>
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${logSupported ? 'bg-green-500' : 'bg-amber-500'}`}></div>
                        <span className={`text-sm font-medium ${logSupported ? 'text-green-700' : 'text-amber-700'}`}>
                            {logSupported ? meta.supportedText(data) : meta.unsupportedText}
                        </span>
                    </div>
                    {!logSupported && (
                        <div className="mt-2 pt-2 border-t border-amber-200">
                            <p className="text-xs text-amber-700 mb-2">
                                {meta.requirementText}
                                {' '}Full backups still work normally.
                            </p>
                            <a
                                href="/settings"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-900 underline"
                            >
                                📖 View Setup Guide in Settings
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </a>
                        </div>
                    )}
                </div>

                {data.enabled && data.coverage && (
                    <div className="mt-3">
                        {/* Coverage Timeline */}
                        <p className="text-xs font-medium text-gray-500 mb-2">PITR Coverage Window</p>
                        <div className="bg-white rounded-lg p-3 border">
                            <div className="flex justify-between items-center">
                                <div className="text-center">
                                    <p className="text-xs text-gray-500">From</p>
                                    <p className="text-sm font-semibold text-gray-800">
                                        {formatDate(data.coverage.start).split(',')[0]}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {formatDate(data.coverage.start).split(',')[1]}
                                    </p>
                                </div>
                                <div className="flex-1 mx-4">
                                    <div className="h-2 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full"></div>
                                    <p className="text-xs text-center text-gray-500 mt-1">
                                        {formatDuration(data.coverage.start, data.coverage.end)} covered
                                    </p>
                                </div>
                                <div className="text-center">
                                    <p className="text-xs text-gray-500">To</p>
                                    <p className="text-sm font-semibold text-gray-800">
                                        {formatDate(data.coverage.end).split(',')[0]}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {formatDate(data.coverage.end).split(',')[1]}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Backup Stats */}
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <div className="bg-white rounded-lg p-3 border">
                                <p className="text-xs text-gray-500 mb-1">Last Full Backup</p>
                                <p className="text-sm font-bold text-gray-800">
                                    {data.lastFullBackup ? formatDate(data.lastFullBackup.timestamp).split(',')[0] : 'None'}
                                </p>
                            </div>
                            <div className="bg-white rounded-lg p-3 border">
                                <p className="text-xs text-gray-500 mb-1">Last Incremental</p>
                                <p className="text-sm font-bold text-gray-800">
                                    {data.lastIncrementalBackup ? formatDate(data.lastIncrementalBackup.timestamp).split(',')[0] : 'None'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="card bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-100">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                    </svg>
                    Point-in-Time Recovery
                </h3>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${anyEnabled
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                    }`}>
                    {anyEnabled ? 'Available' : 'Not Available'}
                </span>
            </div>

            {engineEntries.map(([name, data]) => renderEngineSection(name, data))}

            {!anyEnabled && (
                <div className="text-center py-4">
                    <svg className="w-12 h-12 mx-auto text-gray-300 mb-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <p className="text-gray-500 text-sm">Create a full backup to enable PITR</p>
                </div>
            )}

            {/* Stats */}
            {stats && (
                <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p className="text-lg font-bold text-indigo-600">{stats.fullBackups}</p>
                        <p className="text-xs text-gray-500">Full</p>
                    </div>
                    <div>
                        <p className="text-lg font-bold text-purple-600">{stats.incrementalBackups}</p>
                        <p className="text-xs text-gray-500">Incremental</p>
                    </div>
                    <div>
                        <p className="text-lg font-bold text-gray-700">{stats.totalBackups}</p>
                        <p className="text-xs text-gray-500">Total</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PITRStatusCard;
