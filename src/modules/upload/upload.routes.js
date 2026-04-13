const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../../middleware/auth');

const router = express.Router();

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Create unique filename: timestamp-originalName
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

const getUploadDir = () => path.join(__dirname, '../../../uploads');

const sanitizeDownloadName = (value) => {
    if (!value || typeof value !== 'string') return null;
    return path.basename(value.replace(/[\r\n"]/g, '').trim()) || null;
};

// GET /api/upload/files/:filename - Serve uploaded form files through the API proxy
router.get('/files/:filename', (req, res) => {
    const storedFilename = path.basename(req.params.filename || '');
    if (!storedFilename) {
        return res.status(400).json({ success: false, error: 'Filename is required' });
    }

    const filePath = path.join(getUploadDir(), storedFilename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }

    if (req.query.download === '1') {
        const downloadName = sanitizeDownloadName(req.query.name) || storedFilename;
        return res.download(filePath, downloadName);
    }

    return res.sendFile(filePath);
});

// POST /api/upload - Upload a single file
router.post('/', authenticateToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const fileUrl = `/upload/files/${req.file.filename}`;

        res.json({
            success: true,
            data: {
                url: fileUrl,
                filename: req.file.originalname,
                storedFilename: req.file.filename,
                mimetype: req.file.mimetype,
                size: req.file.size
            }
        });
    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ success: false, error: 'Failed to upload file' });
    }
});

module.exports = router;
