const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Hospital, User } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'meditrack_secret';

// Hospital Login
router.post('/hospital/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const hospital = await Hospital.findOne({ username });
    if (!hospital) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await hospital.comparePassword(password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: hospital._id, type: 'hospital', name: hospital.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, hospital: { id: hospital._id, name: hospital.name, username: hospital.username, departments: hospital.departments } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Staff Login
router.post('/staff/login', async (req, res) => {
  try {
    const { username, password, hospitalId, hospitalUsername } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    let filter = { username };
    if (hospitalId) {
      filter.hospital = hospitalId;
    } else if (hospitalUsername) {
      const hospital = await Hospital.findOne({ username: hospitalUsername });
      if (!hospital) return res.status(401).json({ error: 'Hospital not found' });
      filter.hospital = hospital._id;
    }

    const user = await User.findOne(filter).populate('hospital', 'name departments avgConsultationTime');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, type: 'staff', role: user.role, hospitalId: user.hospital._id, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: user._id, name: user.name, role: user.role, department: user.department, hospital: user.hospital } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register Hospital (public, first-time setup)
router.post('/hospital/register', async (req, res) => {
  try {
    const { name, address, username, password, departments } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password required' });

    const exists = await Hospital.findOne({ username });
    if (exists) return res.status(409).json({ error: 'Username already taken' });

    const hospital = new Hospital({ name, address, username, password, departments: departments || ['General', 'Emergency', 'Cardiology', 'Orthopedics', 'Pediatrics'] });
    await hospital.save();

    // Auto-create admin user for the hospital
    const admin = new User({ name: 'Admin', username: username + '_admin', password, role: 'admin', hospital: hospital._id });
    await admin.save();

    res.json({ message: 'Hospital registered successfully', hospitalId: hospital._id, adminUsername: username + '_admin' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
