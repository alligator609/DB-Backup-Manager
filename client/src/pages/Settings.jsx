import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import Card from '../components/Card';
import Toast from '../components/Toast';
import ConnectionStatus from '../components/ConnectionStatus';
import ChangePasswordModal from '../components/ChangePasswordModal';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';

const Settings = () => {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingFtp, setTestingFtp] = useState(false);
    const [testingS3, setTestingS3] = useState(false);
    const [toast, setToast] = useState(null);
    const [ftpTestResult, setFtpTestResult] = useState(null);
    const [s3TestResult, setS3TestResult] = useState(null);
    const [testingDb, setTestingDb] = useState(false);
    const [dbTestResult, setDbTestResult] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showS3Secret, setShowS3Secret] = useState(false);

    // Storage type: 'local', 'ftp', 's3'
    const [storageType, setStorageType] = useState('local');

    // Custom schedule state
    const [showFullCustom, setShowFullCustom] = useState(false);
    const [showIncrementalCustom, setShowIncrementalCustom] = useState(false);

    // Replica Set setup guide state
    const [showReplicaSetGuide, setShowReplicaSetGuide] = useState(false);
    const [fullCustomTime, setFullCustomTime] = useState({ hour: '2', minute: '0', dayOfWeek: '*' });
    const [incrementalCustom, setIncrementalCustom] = useState({ interval: '5' });

    // Profile Settings state
    const { user, updateUserCredentials } = useAuth();
    const [showProfileModal, setShowProfileModal] = useState(false);

    // Preset options
    const fullBackupPresets = [
        { label: 'Daily at 2 AM', cron: '0 2 * * *', description: 'Recommended' },
        { label: 'Daily at Midnight', cron: '0 0 * * *', description: 'Every day 12:00 AM' },
        { label: 'Every 12 Hours', cron: '0 */12 * * *', description: '12 AM and 12 PM' },
        { label: 'Weekly Sunday', cron: '0 2 * * 0', description: 'Sunday at 2:00 AM' },
    ];

    const incrementalPresets = [
        { label: 'Every 1 Minute', cron: '* * * * *', description: 'Testing only' },
        { label: 'Every 5 Minutes', cron: '*/5 * * * *', description: 'High frequency' },
        { label: 'Every 15 Minutes', cron: '*/15 * * * *', description: 'Recommended' },
        { label: 'Every 30 Minutes', cron: '*/30 * * * *', description: 'Moderate' },
        { label: 'Hourly', cron: '0 * * * *', description: 'Every hour' },
    ];

    useEffect(() => {
        fetchSettings();
    }, []);

    useEffect(() => {
        if (settings) {
            if (settings.s3Bucket) setStorageType('s3');
            else if (settings.ftpHost) setStorageType('ftp');
            else setStorageType('local');
        }
    }, [settings]);

    const fetchSettings = async () => {
        try {
            const response = await api.get('/settings');
            if (response.data.success) {
                setSettings(response.data.data);
            }
        } catch (error) {
            setToast({ message: 'Failed to load settings', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field, value) => {
        setSettings({ ...settings, [field]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);

        try {
            const response = await api.post('/settings', settings);
            if (response.data.success) {
                setToast({ message: 'Settings saved successfully', type: 'success' });
                await fetchSettings();
            }
        } catch (error) {
            setToast({ message: error.response?.data?.message || 'Failed to save settings', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const testFtpConnection = async () => {
        setTestingFtp(true);
        setFtpTestResult(null);

        try {
            const response = await api.post('/settings/test-ftp', settings);
            setFtpTestResult(response.data);
            setToast({ message: response.data.success ? 'FTP connection successful!' : 'FTP connection failed', type: response.data.success ? 'success' : 'error' });
        } catch (error) {
            setFtpTestResult({ success: false, message: 'Connection test failed' });
            setToast({ message: 'FTP connection test failed', type: 'error' });
        } finally {
            setTestingFtp(false);
        }
    };

    const testS3Connection = async () => {
        setTestingS3(true);
        setS3TestResult(null);

        try {
            const response = await api.post('/settings/test-s3', settings);
            setS3TestResult(response.data);
            setToast({ message: response.data.success ? 'S3 connection successful!' : 'S3 connection failed', type: response.data.success ? 'success' : 'error' });
        } catch (error) {
            setS3TestResult({ success: false, message: 'S3 connection test failed' });
            setToast({ message: 'S3 connection test failed', type: 'error' });
        } finally {
            setTestingS3(false);
        }
    };

    const testDbConnection = async (engine) => {
        setTestingDb(engine);
        setDbTestResult(null);

        try {
            const response = await api.post('/settings/test-db', { ...settings, engine });
            setDbTestResult(response.data);
            setToast({ message: response.data.success ? 'Database connection successful!' : 'Database connection failed', type: response.data.success ? 'success' : 'error' });
        } catch (error) {
            setDbTestResult({ success: false, message: 'Connection test failed' });
            setToast({ message: 'Database connection test failed', type: 'error' });
        } finally {
            setTestingDb(false);
        }
    };

    const handleReset = async () => {
        if (!window.confirm('Reset all settings to defaults?')) return;
        setLoading(true);
        try {
            const response = await api.post('/settings/reset');
            if (response.data.success) {
                setToast({ message: 'Settings reset to defaults', type: 'success' });
                await fetchSettings();
            }
        } catch (error) {
            setToast({ message: 'Failed to reset settings', type: 'error' });
            setLoading(false);
        }
    };

    // Apply custom full backup schedule
    const applyFullCustomSchedule = () => {
        const { hour, minute, dayOfWeek } = fullCustomTime;
        const cron = dayOfWeek === '*'
            ? `${minute} ${hour} * * *`
            : `${minute} ${hour} * * ${dayOfWeek}`;
        handleChange('fullBackupCron', cron);
        setShowFullCustom(false);
        setToast({ message: 'Custom schedule applied!', type: 'success' });
    };

    // Apply custom incremental schedule
    const applyIncrementalCustomSchedule = () => {
        const { interval } = incrementalCustom;
        const cron = interval === '60' ? '0 * * * *' : `*/${interval} * * * *`;
        handleChange('incrementalBackupCron', cron);
        setShowIncrementalCustom(false);
        setToast({ message: 'Custom schedule applied!', type: 'success' });
    };

    const getCronDescription = (cron, type) => {
        if (!cron) return 'Not configured';
        const presets = type === 'full' ? fullBackupPresets : incrementalPresets;
        const preset = presets.find(p => p.cron === cron);
        if (preset) return preset.label;

        const parts = cron.split(' ');
        if (parts.length !== 5) return cron;
        const [minute, hour, , , dayOfWeek] = parts;

        if (minute === '*' && hour === '*') return 'Every minute';
        if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`;
        if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hours`;
        if (dayOfWeek !== '*') {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return `${days[parseInt(dayOfWeek)]}s at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
        }
        return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    };

    if (loading) {
        return (
            <div className="min-h-screen">
                <Navbar />
                <div className="max-w-7xl mx-auto px-4 py-20 flex justify-center">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    // Engine enable flags — fall back to the old exclusive dbEngine selector
    // for settings saved before multi-engine support
    const mongoEngineOn = settings.mongoEnabled !== undefined
        ? settings.mongoEnabled
        : settings.dbEngine !== 'mysql';
    const mysqlEngineOn = settings.mysqlEnabled !== undefined
        ? settings.mysqlEnabled
        : settings.dbEngine === 'mysql';

    return (
        <div className="min-h-screen">
            <Navbar />

            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fadeIn">
                <div className="mb-6 sm:mb-8">
                    <h1 className="text-2xl sm:text-4xl font-bold text-gradient mb-2">Settings</h1>
                    <p className="text-gray-600 text-sm sm:text-lg">Configure backup settings and connections</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Profile Settings */}
                    <Card title="👤 Profile Settings">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl p-4 border border-gray-200">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 bg-gradient-to-r from-primary-500 to-primary-600 rounded-xl flex items-center justify-center shadow-lg">
                                        <span className="text-white font-bold text-xl">{(user?.username || 'A')[0].toUpperCase()}</span>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-500">Logged in as</p>
                                        <p className="text-lg font-bold text-gray-900">{user?.username || 'admin'}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowProfileModal(true)}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:border-primary-500 hover:text-primary-600 transition-all font-medium"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                    </svg>
                                    Change Password
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 px-2">
                                🔒 Your credentials are securely stored and encrypted locally
                            </p>
                        </div>
                    </Card>

                    {/* Database Engines — enable one or both */}
                    <Card title="Database Engines">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {[
                                { key: 'mongoEnabled', label: '🍃 MongoDB', desc: 'mongodump + oplog incrementals' },
                                { key: 'mysqlEnabled', label: '🐬 MySQL', desc: 'mysqldump + binlog incrementals' }
                            ].map((eng) => {
                                const enabled = settings[eng.key] !== undefined
                                    ? settings[eng.key]
                                    : (eng.key === 'mongoEnabled' ? settings.dbEngine !== 'mysql' : settings.dbEngine === 'mysql');
                                return (
                                    <button
                                        key={eng.key}
                                        type="button"
                                        onClick={() => handleChange(eng.key, !enabled)}
                                        className={`p-4 rounded-xl border-2 text-left transition-all ${enabled
                                                ? 'border-primary-500 bg-primary-50'
                                                : 'border-gray-200 bg-white hover:border-gray-300'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-gray-900">{eng.label}</span>
                                            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${enabled ? 'bg-primary-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                                {enabled ? 'ON' : 'OFF'}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">{eng.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-xs text-gray-500 mt-3">💡 Enable both to back up MongoDB and MySQL with the same app — backups and restore chains are tracked per engine.</p>
                    </Card>

                    {/* MongoDB Configuration */}
                    {mongoEngineOn && (<>
                    <Card title="MongoDB Configuration">
                        <div>
                            <label className="label flex items-center gap-2">
                                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z" />
                                    <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z" />
                                    <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z" />
                                </svg>
                                MongoDB Connection URL
                            </label>
                            <input type="text" value={settings.mongoUrl || ''} onChange={(e) => handleChange('mongoUrl', e.target.value)} className="input" placeholder="mongodb://host.docker.internal:27017/yourdb" />
                            <p className="text-xs text-gray-500 mt-2">🔒 Full MongoDB connection string (encrypted at rest)</p>
                        </div>
                        <button type="button" onClick={() => testDbConnection('mongodb')} disabled={testingDb === 'mongodb'} className="btn-primary w-full mt-4">
                            {testingDb === 'mongodb' ? 'Testing...' : '✓ Test MongoDB Connection'}
                        </button>
                        {dbTestResult && <div className="mt-3"><ConnectionStatus testResult={dbTestResult} /></div>}
                    </Card>

                    {/* Replica Set Requirement Info */}
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border-2 border-amber-200 p-5 shadow-sm">
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <h4 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                                    ⚠️ Important: MongoDB Replica Set Required
                                </h4>
                                <p className="text-gray-700 text-sm mb-3">
                                    To use <strong>Incremental Backups</strong> and <strong>Point-in-Time Recovery (PITR)</strong>,
                                    your MongoDB must be running as a <strong>Replica Set</strong>. This enables oplog (operation log)
                                    which tracks all database changes.
                                </p>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                                        ✓ Full Backups work without Replica Set
                                    </span>
                                    <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                                        ⚠ Incremental needs Replica Set
                                    </span>
                                    <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                                        ⚠ PITR needs Replica Set
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setShowReplicaSetGuide(!showReplicaSetGuide)}
                                    className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 border-2 border-amber-300 rounded-xl text-amber-700 font-semibold transition-all text-sm"
                                >
                                    <svg className={`w-4 h-4 transition-transform ${showReplicaSetGuide ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                    {showReplicaSetGuide ? 'Hide Setup Guide' : '📖 Show Setup Guide'}
                                </button>
                            </div>
                        </div>

                        {/* Collapsible Setup Guide */}
                        {showReplicaSetGuide && (
                            <div className="mt-5 pt-5 border-t-2 border-amber-200 space-y-6 animate-fadeIn">

                                {/* Docker Users Section */}
                                <div className="bg-white rounded-xl p-5 border border-gray-200">
                                    <h5 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                                        <span className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white text-sm">🐳</span>
                                        For Docker Users (Recommended)
                                    </h5>
                                    <div className="space-y-3 text-sm">
                                        <p className="text-gray-600">Add these options to your MongoDB container:</p>
                                        <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                                            <code className="text-green-400 text-xs whitespace-pre font-mono">
                                                {`# docker-compose.yml
services:
  mongodb:
    image: mongo:latest
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"

# After starting, run this ONCE:
docker exec -it <container_name> mongosh --eval "rs.initiate()"`}
                                            </code>
                                        </div>
                                    </div>
                                </div>

                                {/* Standalone MongoDB Section */}
                                <div className="bg-white rounded-xl p-5 border border-gray-200">
                                    <h5 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                                        <span className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center text-white text-sm">🖥️</span>
                                        For Standalone MongoDB
                                    </h5>
                                    <div className="space-y-3 text-sm">
                                        <div className="space-y-2">
                                            <p className="text-gray-600"><strong>Step 1:</strong> Edit your MongoDB config file:</p>
                                            <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                                                <code className="text-green-400 text-xs font-mono">
                                                    {`# mongod.conf
replication:
  replSetName: "rs0"`}
                                                </code>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-gray-600"><strong>Step 2:</strong> Restart MongoDB and initialize:</p>
                                            <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                                                <code className="text-green-400 text-xs font-mono">
                                                    {`# Restart MongoDB service, then run:
mongosh --eval "rs.initiate()"`}
                                                </code>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Connection String Format */}
                                <div className="bg-white rounded-xl p-5 border border-gray-200">
                                    <h5 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                                        <span className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center text-white text-sm">🔗</span>
                                        Connection String Examples
                                    </h5>
                                    <div className="space-y-3 text-sm">
                                        <div className="bg-gray-50 rounded-lg p-3 border">
                                            <p className="text-xs text-gray-500 mb-1">Local Replica Set:</p>
                                            <code className="text-purple-700 text-xs font-mono break-all">
                                                mongodb://localhost:27017/mydb?replicaSet=rs0
                                            </code>
                                        </div>
                                        <div className="bg-gray-50 rounded-lg p-3 border">
                                            <p className="text-xs text-gray-500 mb-1">With Authentication:</p>
                                            <code className="text-purple-700 text-xs font-mono break-all">
                                                mongodb://user:password@localhost:27017/mydb?replicaSet=rs0&authSource=admin
                                            </code>
                                        </div>
                                        <div className="bg-gray-50 rounded-lg p-3 border">
                                            <p className="text-xs text-gray-500 mb-1">MongoDB Atlas (already Replica Set):</p>
                                            <code className="text-purple-700 text-xs font-mono break-all">
                                                mongodb+srv://user:password@cluster.mongodb.net/mydb
                                            </code>
                                        </div>
                                    </div>
                                </div>

                                {/* Verify Setup */}
                                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-5 border-2 border-green-200">
                                    <h5 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                                        <span className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center text-white text-sm">✓</span>
                                        Verify Your Setup
                                    </h5>
                                    <p className="text-gray-600 text-sm mb-3">Run this command in MongoDB shell to check replica set status:</p>
                                    <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
                                        <code className="text-green-400 text-xs font-mono">
                                            mongosh --eval "rs.status()"
                                        </code>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-3">
                                        ✅ If you see <code className="bg-white px-1 rounded text-green-700">"ok": 1</code> and member status, you're all set!
                                    </p>
                                </div>

                                {/* Troubleshooting */}
                                <div className="bg-white rounded-xl p-5 border border-gray-200">
                                    <h5 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                                        <span className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center text-white text-sm">🔧</span>
                                        Common Issues
                                    </h5>
                                    <ul className="space-y-2 text-sm text-gray-600">
                                        <li className="flex items-start gap-2">
                                            <span className="text-red-500 font-bold">•</span>
                                            <span><strong>"not running with --replSet"</strong> - MongoDB wasn't started with replica set config</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-red-500 font-bold">•</span>
                                            <span><strong>"no replset config"</strong> - Need to run <code className="bg-gray-100 px-1 rounded">rs.initiate()</code></span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-red-500 font-bold">•</span>
                                            <span><strong>Authentication failed</strong> - Add <code className="bg-gray-100 px-1 rounded">?authSource=admin</code> to connection string</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                    </>)}

                    {/* MySQL Configuration */}
                    {mysqlEngineOn && (<>
                    <Card title="MySQL Configuration">
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="sm:col-span-2">
                                    <label className="label">Host</label>
                                    <input type="text" value={settings.mysqlHost || ''} onChange={(e) => handleChange('mysqlHost', e.target.value)} className="input" placeholder="host.docker.internal" />
                                </div>
                                <div>
                                    <label className="label">Port</label>
                                    <input type="number" value={settings.mysqlPort || 3306} onChange={(e) => handleChange('mysqlPort', parseInt(e.target.value) || 3306)} className="input" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Username</label>
                                    <input type="text" value={settings.mysqlUser || ''} onChange={(e) => handleChange('mysqlUser', e.target.value)} className="input" placeholder="backup_user" />
                                </div>
                                <div>
                                    <label className="label">Password</label>
                                    <input type={showPassword ? "text" : "password"} value={settings.mysqlPassword || ''} onChange={(e) => handleChange('mysqlPassword', e.target.value)} className="input" />
                                </div>
                            </div>
                            <div>
                                <label className="label">Database (optional)</label>
                                <input type="text" value={settings.mysqlDatabase || ''} onChange={(e) => handleChange('mysqlDatabase', e.target.value)} className="input" placeholder="Leave empty to back up all databases" />
                                <p className="text-xs text-gray-500 mt-2">🔒 Password is encrypted at rest. Docker users: use <code className="bg-gray-100 px-1 rounded">host.docker.internal</code> to reach a MySQL server on the host machine.</p>
                            </div>
                            <button type="button" onClick={() => testDbConnection('mysql')} disabled={testingDb === 'mysql'} className="btn-primary w-full">
                                {testingDb === 'mysql' ? 'Testing...' : '✓ Test MySQL Connection'}
                            </button>
                            {dbTestResult && <ConnectionStatus testResult={dbTestResult} />}
                        </div>
                    </Card>

                    {/* Binlog Requirement Info */}
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border-2 border-amber-200 p-5 shadow-sm">
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <h4 className="text-lg font-bold text-gray-900 mb-2">
                                    ⚠️ Important: Binary Logging Required for Incremental Backups
                                </h4>
                                <p className="text-gray-700 text-sm mb-3">
                                    To use <strong>Incremental Backups</strong> and <strong>Point-in-Time Recovery (PITR)</strong>,
                                    your MySQL server must have the <strong>binary log (binlog)</strong> enabled — the MySQL
                                    equivalent of MongoDB's oplog.
                                </p>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                                        ✓ Full Backups work without binlog
                                    </span>
                                    <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                                        ⚠ Incremental needs binlog
                                    </span>
                                    <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                                        ⚠ PITR needs binlog
                                    </span>
                                </div>
                                <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto mb-3">
                                    <code className="text-green-400 text-xs whitespace-pre font-mono">
                                        {`# my.cnf / my.ini  (then restart MySQL)
[mysqld]
server_id = 1
log_bin = mysql-bin
binlog_format = ROW

# Verify with:
mysql -e "SHOW VARIABLES LIKE 'log_bin';"`}
                                    </code>
                                </div>
                                <p className="text-xs text-gray-600">
                                    🔑 The backup user needs <code className="bg-gray-100 px-1 rounded">SELECT</code>, <code className="bg-gray-100 px-1 rounded">RELOAD</code>, <code className="bg-gray-100 px-1 rounded">LOCK TABLES</code> and <code className="bg-gray-100 px-1 rounded">REPLICATION CLIENT</code> privileges. If the user authenticates with <code className="bg-gray-100 px-1 rounded">caching_sha2_password</code> (MySQL 8 default), MariaDB client tools may not connect — prefer <code className="bg-gray-100 px-1 rounded">mysql_native_password</code>.
                                </p>
                            </div>
                        </div>
                    </div>
                    </>)}

                    {/* Storage Configuration */}
                    <Card title="Storage Configuration">
                        <div className="space-y-6">
                            <div className="flex gap-2 bg-gray-100 rounded-xl p-1.5 overflow-x-auto">
                                {['local', 'ftp', 's3', 'rclone'].map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => type !== 'rclone' && setStorageType(type)}
                                        disabled={type === 'rclone'}
                                        className={`flex-1 min-w-[100px] px-3 sm:px-4 py-2 sm:py-3 rounded-lg font-semibold transition-all text-sm sm:text-base whitespace-nowrap relative ${type === 'rclone'
                                                ? 'text-gray-400 cursor-not-allowed bg-gray-50'
                                                : storageType === type
                                                    ? 'bg-white text-gray-900 shadow-md'
                                                    : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        {type === 'local' ? '📁 Local Only' : type === 'ftp' ? '🖥️ FTP Server' : type === 's3' ? '☁️ AWS S3' : '🔄 rclone'}
                                        {type === 'rclone' && (
                                            <span className="absolute -top-2 -right-1 px-1.5 py-0.5 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] font-bold rounded-full shadow-sm animate-pulse">
                                                SOON
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {storageType === 'local' && (
                                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                                    <p className="text-sm text-blue-700">ℹ️ Backups stored locally only. Consider FTP or S3 for disaster recovery.</p>
                                </div>
                            )}

                            {storageType === 'ftp' && (
                                <div className="space-y-4 bg-blue-50 rounded-xl p-5 border border-blue-200">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="label">FTP Host</label>
                                            <input type="text" value={settings.ftpHost || ''} onChange={(e) => handleChange('ftpHost', e.target.value)} className="input" placeholder="ftp.example.com" />
                                        </div>
                                        <div>
                                            <label className="label">FTP Port</label>
                                            <input type="number" value={settings.ftpPort || 21} onChange={(e) => handleChange('ftpPort', parseInt(e.target.value))} className="input" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="label">Username</label>
                                            <input type="text" value={settings.ftpUser || ''} onChange={(e) => handleChange('ftpUser', e.target.value)} className="input" />
                                        </div>
                                        <div>
                                            <label className="label">Password</label>
                                            <input type={showPassword ? "text" : "password"} value={settings.ftpPassword || ''} onChange={(e) => handleChange('ftpPassword', e.target.value)} className="input" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="label">Base Path</label>
                                        <input type="text" value={settings.ftpBasePath || ''} onChange={(e) => handleChange('ftpBasePath', e.target.value)} className="input" placeholder="/backups" />
                                    </div>
                                    <button type="button" onClick={testFtpConnection} disabled={testingFtp} className="btn-primary w-full">
                                        {testingFtp ? 'Testing...' : '✓ Test FTP Connection'}
                                    </button>
                                    {ftpTestResult && <ConnectionStatus testResult={ftpTestResult} />}
                                </div>
                            )}

                            {storageType === 's3' && (
                                <div className="space-y-4 bg-orange-50 rounded-xl p-5 border border-orange-200">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="label">Access Key ID</label>
                                            <input type="text" value={settings.s3AccessKey || ''} onChange={(e) => handleChange('s3AccessKey', e.target.value)} className="input" />
                                        </div>
                                        <div>
                                            <label className="label">Secret Access Key</label>
                                            <input type={showS3Secret ? "text" : "password"} value={settings.s3SecretKey || ''} onChange={(e) => handleChange('s3SecretKey', e.target.value)} className="input" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="label">Bucket Name</label>
                                            <input type="text" value={settings.s3Bucket || ''} onChange={(e) => handleChange('s3Bucket', e.target.value)} className="input" />
                                        </div>
                                        <div>
                                            <label className="label">Region</label>
                                            <select value={settings.s3Region || 'us-east-1'} onChange={(e) => handleChange('s3Region', e.target.value)} className="input">
                                                <option value="us-east-1">US East</option>
                                                <option value="eu-west-1">EU West</option>
                                                <option value="ap-south-1">Asia Pacific (Mumbai)</option>
                                            </select>
                                        </div>
                                    </div>
                                    <button type="button" onClick={testS3Connection} disabled={testingS3} className="btn-primary w-full">
                                        {testingS3 ? 'Testing...' : '✓ Test S3 Connection'}
                                    </button>
                                    {s3TestResult && <ConnectionStatus testResult={s3TestResult} />}
                                </div>
                            )}

                            {/* rclone Coming Soon Notice */}
                            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-5 border-2 border-amber-200">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
                                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <h4 className="font-bold text-gray-900">🔄 rclone Integration</h4>
                                            <span className="px-2 py-0.5 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold rounded-full">
                                                Coming Soon
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-600 mb-3">
                                            We're working on rclone support to enable backups to <strong>70+ cloud storage providers</strong> including
                                            Google Drive, Dropbox, OneDrive, Backblaze B2, Wasabi, and many more!
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            <span className="px-2 py-1 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200">
                                                📦 Google Drive
                                            </span>
                                            <span className="px-2 py-1 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200">
                                                📦 Dropbox
                                            </span>
                                            <span className="px-2 py-1 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200">
                                                📦 OneDrive
                                            </span>
                                            <span className="px-2 py-1 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200">
                                                📦 Backblaze B2
                                            </span>
                                            <span className="px-2 py-1 bg-white text-gray-500 text-xs font-medium rounded-lg border border-gray-200">
                                                + 70 more...
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* BACKUP SCHEDULES */}
                    <Card title="📅 Backup Schedules">
                        <div className="space-y-6">
                            {/* Info Banner */}
                            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                                <p className="text-sm text-blue-700">
                                    <strong>💡 Tip:</strong> Run Full Backups daily and Incremental Backups every 5-15 minutes for best protection.
                                </p>
                            </div>

                            {/* Full Backup Schedule */}
                            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-5 border border-purple-200">
                                <div className="flex items-center justify-between mb-4">
                                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                                        <span className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center text-white text-sm">📦</span>
                                        Full Backup Schedule
                                    </h4>
                                    <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm">
                                        <span className="text-sm font-bold text-purple-700">{getCronDescription(settings.fullBackupCron, 'full')}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
                                    {fullBackupPresets.map((preset) => (
                                        <button
                                            key={preset.cron}
                                            type="button"
                                            onClick={() => { handleChange('fullBackupCron', preset.cron); setShowFullCustom(false); }}
                                            className={`p-3 rounded-lg border-2 transition-all text-left ${settings.fullBackupCron === preset.cron && !showFullCustom
                                                ? 'border-purple-500 bg-purple-100'
                                                : 'border-gray-200 bg-white hover:border-purple-300'
                                                }`}
                                        >
                                            <p className="font-semibold text-gray-900 text-sm">{preset.label}</p>
                                            <p className="text-xs text-gray-500">{preset.description}</p>
                                        </button>
                                    ))}
                                    {/* Custom Button */}
                                    <button
                                        type="button"
                                        onClick={() => setShowFullCustom(!showFullCustom)}
                                        className={`p-3 rounded-lg border-2 transition-all text-left ${showFullCustom ? 'border-purple-500 bg-purple-100' : 'border-dashed border-gray-300 bg-white hover:border-purple-400'
                                            }`}
                                    >
                                        <p className="font-semibold text-gray-900 text-sm">⚙️ Custom</p>
                                        <p className="text-xs text-gray-500">Set your own time</p>
                                    </button>
                                </div>

                                {/* Custom Time Picker for Full Backup */}
                                {showFullCustom && (
                                    <div className="bg-white rounded-lg p-4 border-2 border-purple-200 mt-3">
                                        <p className="text-sm font-semibold text-gray-700 mb-3">Set Custom Full Backup Time:</p>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-500">Hour</label>
                                                <select
                                                    value={fullCustomTime.hour}
                                                    onChange={(e) => setFullCustomTime({ ...fullCustomTime, hour: e.target.value })}
                                                    className="input"
                                                >
                                                    {[...Array(24)].map((_, i) => (
                                                        <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500">Minute</label>
                                                <select
                                                    value={fullCustomTime.minute}
                                                    onChange={(e) => setFullCustomTime({ ...fullCustomTime, minute: e.target.value })}
                                                    className="input"
                                                >
                                                    {[0, 15, 30, 45].map((m) => (
                                                        <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500">Day</label>
                                                <select
                                                    value={fullCustomTime.dayOfWeek}
                                                    onChange={(e) => setFullCustomTime({ ...fullCustomTime, dayOfWeek: e.target.value })}
                                                    className="input"
                                                >
                                                    <option value="*">Every Day</option>
                                                    <option value="0">Sunday</option>
                                                    <option value="1">Monday</option>
                                                    <option value="2">Tuesday</option>
                                                    <option value="3">Wednesday</option>
                                                    <option value="4">Thursday</option>
                                                    <option value="5">Friday</option>
                                                    <option value="6">Saturday</option>
                                                </select>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={applyFullCustomSchedule}
                                            className="mt-3 w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition"
                                        >
                                            ✓ Apply Custom Schedule
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Incremental Backup Schedule */}
                            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-5 border border-green-200">
                                <div className="flex items-center justify-between mb-4">
                                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                                        <span className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center text-white text-sm">📈</span>
                                        Incremental Backup Schedule
                                    </h4>
                                    <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm">
                                        <span className="text-sm font-bold text-green-700">{getCronDescription(settings.incrementalBackupCron, 'incremental')}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
                                    {incrementalPresets.map((preset) => (
                                        <button
                                            key={preset.cron}
                                            type="button"
                                            onClick={() => { handleChange('incrementalBackupCron', preset.cron); setShowIncrementalCustom(false); }}
                                            className={`p-3 rounded-lg border-2 transition-all text-left ${settings.incrementalBackupCron === preset.cron && !showIncrementalCustom
                                                ? 'border-green-500 bg-green-100'
                                                : 'border-gray-200 bg-white hover:border-green-300'
                                                }`}
                                        >
                                            <p className="font-semibold text-gray-900 text-sm">{preset.label}</p>
                                            <p className="text-xs text-gray-500">{preset.description}</p>
                                        </button>
                                    ))}
                                    {/* Custom Button */}
                                    <button
                                        type="button"
                                        onClick={() => setShowIncrementalCustom(!showIncrementalCustom)}
                                        className={`p-3 rounded-lg border-2 transition-all text-left ${showIncrementalCustom ? 'border-green-500 bg-green-100' : 'border-dashed border-gray-300 bg-white hover:border-green-400'
                                            }`}
                                    >
                                        <p className="font-semibold text-gray-900 text-sm">⚙️ Custom</p>
                                        <p className="text-xs text-gray-500">Set interval</p>
                                    </button>
                                </div>

                                {/* Custom Interval Picker for Incremental */}
                                {showIncrementalCustom && (
                                    <div className="bg-white rounded-lg p-4 border-2 border-green-200 mt-3">
                                        <p className="text-sm font-semibold text-gray-700 mb-3">Set Custom Interval:</p>
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm text-gray-600">Run every</span>
                                            <select
                                                value={incrementalCustom.interval}
                                                onChange={(e) => setIncrementalCustom({ interval: e.target.value })}
                                                className="input w-32"
                                            >
                                                <option value="1">1</option>
                                                <option value="2">2</option>
                                                <option value="3">3</option>
                                                <option value="5">5</option>
                                                <option value="10">10</option>
                                                <option value="15">15</option>
                                                <option value="20">20</option>
                                                <option value="30">30</option>
                                                <option value="45">45</option>
                                                <option value="60">60</option>
                                            </select>
                                            <span className="text-sm text-gray-600">minutes</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={applyIncrementalCustomSchedule}
                                            className="mt-3 w-full py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition"
                                        >
                                            ✓ Apply Custom Schedule
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Schedule Summary */}
                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                <h4 className="font-semibold text-gray-900 mb-3">📋 Schedule Summary</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                    <div className="bg-white p-3 rounded-lg border flex items-center gap-3">
                                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">📦</div>
                                        <div>
                                            <p className="text-xs text-gray-500">Full Backup</p>
                                            <p className="font-bold text-purple-700">{getCronDescription(settings.fullBackupCron, 'full')}</p>
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border flex items-center gap-3">
                                        <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">📈</div>
                                        <div>
                                            <p className="text-xs text-gray-500">Incremental Backup</p>
                                            <p className="font-bold text-green-700">{getCronDescription(settings.incrementalBackupCron, 'incremental')}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Retention Policy */}
                    <Card title="Retention Policy">
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Keep Last N Backups</label>
                                    <input type="number" value={settings.keepLastNBackups || 30} onChange={(e) => handleChange('keepLastNBackups', parseInt(e.target.value))} className="input" min="1" />
                                </div>
                                <div>
                                    <label className="label">Retention Days</label>
                                    <input type="number" value={settings.retentionDays || 30} onChange={(e) => handleChange('retentionDays', parseInt(e.target.value))} className="input" min="1" />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 p-4 bg-blue-50 rounded-xl border border-blue-200 cursor-pointer">
                                <input type="checkbox" checked={settings.keepLocalBackups || false} onChange={(e) => handleChange('keepLocalBackups', e.target.checked)} className="w-5 h-5 text-primary-500 rounded" />
                                <span className="text-sm font-semibold text-gray-700">Keep local backups after remote upload</span>
                            </label>
                        </div>
                    </Card>

                    {/* Save Button */}
                    <div className="flex flex-col sm:flex-row justify-end gap-3 sticky bottom-4 bg-white/90 backdrop-blur p-3 sm:p-4 rounded-2xl shadow-xl border">
                        <button type="button" onClick={handleReset} className="btn-secondary">
                            🔄 Reset
                        </button>
                        <button type="submit" disabled={saving} className="btn-primary">
                            {saving ? 'Saving...' : '✓ Save Settings'}
                        </button>
                    </div>
                </form>
            </div>

            {toast && (
                <div className="fixed bottom-4 right-4 z-50">
                    <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
                </div>
            )}

            {/* Profile Change Password Modal */}
            <ChangePasswordModal
                isOpen={showProfileModal}
                onClose={() => setShowProfileModal(false)}
                onSuccess={(newUsername) => {
                    updateUserCredentials(newUsername);
                    setShowProfileModal(false);
                    setToast({ message: 'Credentials updated successfully!', type: 'success' });
                }}
                currentUsername={user?.username || 'admin'}
                isFirstLogin={false}
            />
        </div>
    );
};

export default Settings;
