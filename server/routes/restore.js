const express = require('express');
const router = express.Router();
const RestoreService = require('../services/RestoreService');
const LogService = require('../services/LogService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure upload
const upload = multer({
    dest: path.join(process.cwd(), 'data', 'uploads'),
    limits: { fileSize: 1024 * 1024 * 1024 * 5 } // 5GB limit
});

/**
 * @route GET /api/restore/status
 * @desc Get current restore status
 */
router.get('/status', async (req, res) => {
    try {
        const status = RestoreService.getCurrentStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route POST /api/restore/point-in-time
 * @desc Restore to a specific point in time (PITR)
 */
router.post('/point-in-time', async (req, res) => {
    try {
        const { timestamp, engine } = req.body;

        if (!timestamp) {
            return res.status(400).json({
                success: false,
                message: 'Target timestamp is required'
            });
        }

        // Run restore asynchronously
        const restorePromise = RestoreService.restoreToPointInTime(timestamp, engine);
        
        // Don't wait for completion, return immediately
        restorePromise.catch(error => {
            console.error('PITR restore failed:', error);
        });
        
        return res.json({
            success: true,
            message: `Point-in-time restore started for ${timestamp}`,
            targetTime: timestamp
        });
    } catch (error) {
        console.error('PITR restore request failed:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route GET /api/restore/preview/:timestamp
 * @desc Preview the backup chain for a point-in-time restore
 */
router.get('/preview/:timestamp', async (req, res) => {
    try {
        const { timestamp } = req.params;
        const chain = await RestoreService.previewRestore(timestamp, req.query.engine);
        res.json({ success: true, data: chain });
    } catch (error) {
        console.error('Preview restore failed:', error);
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * @route POST /api/restore/:id
 * @desc Restore a specific backup
 */
router.post('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Run restore asynchronously
        const restorePromise = RestoreService.restoreBackup(id);
        
        // Don't wait for completion, return immediately
        restorePromise.catch(error => {
            console.error('Restore failed:', error);
        });
        
        res.json({ success: true, message: 'Restore started' });
    } catch (error) {
        console.error('Restore request failed:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route POST /api/restore/upload
 * @desc Upload and restore a backup file
 */
router.post('/upload', upload.single('backup'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const type = req.body.type || 'full';
        const isEncrypted = req.body.encrypted === 'true';

        // Create a mock backup object to pass to RestoreService.restoreSingleBackup
        const mockBackup = {
            id: 'uploaded_' + Date.now(),
            filename: req.file.originalname,
            local_path: req.file.path,
            type: type,
            encrypted: isEncrypted ? 1 : 0,
            engine: req.body.engine || null // falls back to the configured engine
        };

        await RestoreService.restoreSingleBackup(mockBackup);
        
        // Remove file after success
        await fs.promises.unlink(req.file.path).catch(() => {});

        res.json({ success: true, message: 'Restored from upload successfully' });

    } catch (error) {
        console.error('Upload restore failed:', error);
        // Cleanup on error
        if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;

