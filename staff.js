const express = require('express');
const router = express.Router();
const { User, Hospital, DoctorStatus } = require('../models');
const { authMiddleware, roleCheck } = require('../middleware');

// Get all staff for hospital
router.get('/', authMiddleware, roleCheck('admin'), async (req, res) => {
  try {
    const hospitalId = req.user.hospitalId || req.user.id;
    const staff = await User.find({ hospital: hospitalId }).select('-password');
    res.json({ staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add staff member
router.post('/', authMiddleware, roleCheck('admin'), async (req, res) => {
  try {
    const { name, username, password, role, department } = req.body;
    const hospitalId = req.user.hospitalId || req.user.id;

    if (!name || !username || !password || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const exists = await User.findOne({ username, hospital: hospitalId });
    if (exists) return res.status(409).json({ error: 'Username already exists' });

    const user = new User({ name, username, password, role, department, hospital: hospitalId });
    await user.save();
    res.json({ user: { id: user._id, name, username, role, department } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete staff member
router.delete('/:id', authMiddleware, roleCheck('admin'), async (req, res) => {
  try {
    const hospitalId = req.user.hospitalId || req.user.id;
    await User.findOneAndDelete({ _id: req.params.id, hospital: hospitalId });
    res.json({ message: 'Staff removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update hospital settings
router.patch('/hospital/settings', authMiddleware, roleCheck('admin'), async (req, res) => {
  try {
    const hospitalId = req.user.hospitalId || req.user.id;
    const { avgConsultationTime, departments } = req.body;
    const hospital = await Hospital.findByIdAndUpdate(hospitalId,
      { avgConsultationTime, departments },
      { new: true }
    ).select('-password');
    res.json({ hospital });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get hospital info
router.get('/hospital/info', authMiddleware, async (req, res) => {
  try {
    const hospitalId = req.user.hospitalId || req.user.id;
    const hospital = await Hospital.findById(hospitalId).select('-password');
    res.json({ hospital });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
