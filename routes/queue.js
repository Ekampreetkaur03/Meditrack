const express = require('express');
const router = express.Router();
const { Token, Hospital, DoctorStatus } = require('../models');
const { authMiddleware, roleCheck } = require('../middleware');
const whatsapp = require('../whatsapp');

let ioInstance = null;
function setIO(io) { ioInstance = io; }

// Calculate ETA for a patient
async function calculateETA(hospitalId, department, priority) {
  const hospital = await Hospital.findById(hospitalId);
  const avgTime = hospital ? hospital.avgConsultationTime : 10;

  const waitingCount = await Token.countDocuments({
    hospital: hospitalId,
    department,
    status: 'Waiting',
    priority: { $ne: 'Emergency' }
  });

  const emergencyCount = await Token.countDocuments({
    hospital: hospitalId,
    department,
    status: { $in: ['Waiting', 'Called'] },
    priority: 'Emergency'
  });

  let position = waitingCount + 1;
  if (priority === 'Urgent') position = Math.max(1, Math.floor(waitingCount / 2));
  if (priority === 'Emergency') position = emergencyCount + 1;

  return { eta: position * avgTime, position };
}

// Add patient to queue (receptionist/admin)
router.post('/add', authMiddleware, roleCheck('admin', 'receptionist'), async (req, res) => {
  try {
    const { patientName, phone, age, gender, department, priority, notes } = req.body;
    const hospitalId = req.user.hospitalId || req.user.id;

    // Validate
    if (!patientName || !phone || !department) {
      return res.status(400).json({ error: 'Patient name, phone, and department are required' });
    }
    if (!/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''))) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Get next token number for this hospital+department today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastToken = await Token.findOne({
      hospital: hospitalId,
      createdAt: { $gte: today }
    }).sort({ tokenNumber: -1 });

    const tokenNumber = lastToken ? lastToken.tokenNumber + 1 : 1;

    const { eta } = await calculateETA(hospitalId, department, priority || 'Normal');

    const token = new Token({
      tokenNumber, patientName, phone: phone.replace(/\D/g, ''), age, gender,
      department, priority: priority || 'Normal', notes,
      hospital: hospitalId
    });
    await token.save();

    // Send WhatsApp confirmation
    const hospital = await Hospital.findById(hospitalId);
    const hospitalName = hospital ? hospital.name : 'MediTrack Hospital';
    const msg = whatsapp.templates.tokenConfirmationMsg(patientName, tokenNumber, department, hospitalName, eta);
    whatsapp.sendWhatsAppMessage(phone, msg);

    // Also notify admin
    const ownerPhone = process.env.WHATSAPP_OWNER;
    if (ownerPhone) {
      whatsapp.sendWhatsAppMessage(ownerPhone, `🆕 New Patient Added\n${patientName} | Token #${tokenNumber}\nDept: ${department} | Priority: ${priority || 'Normal'}\nHospital: ${hospitalName}`);
    }

    // Emit socket event
    if (ioInstance) {
      ioInstance.to(`hospital_${hospitalId}`).emit('queue_update', { type: 'new_token', token });
    }

    res.json({ token, eta, message: 'Token created and WhatsApp sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get queue status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const hospitalId = req.user.hospitalId || req.user.id;
    const { department } = req.query;

    const filter = { hospital: hospitalId, status: { $in: ['Waiting', 'Called', 'In-Progress'] } };
    if (department) filter.department = department;

    const tokens = await Token.find(filter)
      .populate('doctor', 'name')
      .sort({ priority: -1, createdAt: 1 });

    // Sort: Emergency > Urgent > Normal
    const priorityOrder = { Emergency: 0, Urgent: 1, Normal: 2 };
    tokens.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.createdAt - b.createdAt);

    const stats = {
      total: tokens.length,
      waiting: tokens.filter(t => t.status === 'Waiting').length,
      called: tokens.filter(t => t.status === 'Called').length,
      inProgress: tokens.filter(t => t.status === 'In-Progress').length,
    };

    res.json({ tokens, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Call next patient (doctor)
router.post('/next', authMiddleware, roleCheck('doctor', 'admin'), async (req, res) => {
  try {
    const hospitalId = req.user.hospitalId || req.user.id;
    const { department } = req.body;

    const priorityOrder = { Emergency: 0, Urgent: 1, Normal: 2 };

    const waiting = await Token.find({
      hospital: hospitalId,
      department: department || req.user.department,
      status: 'Waiting'
    });

    if (!waiting.length) return res.status(404).json({ error: 'No patients waiting' });

    waiting.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.createdAt - b.createdAt);
    const next = waiting[0];

    next.status = 'Called';
    next.calledAt = new Date();
    next.doctor = req.user.id;
    await next.save();

    // WhatsApp alert
    const hospital = await Hospital.findById(hospitalId);
    const msg = whatsapp.templates.callNowMsg(next.patientName, next.tokenNumber, next.department, hospital?.name || 'Hospital');
    whatsapp.sendWhatsAppMessage(next.phone, msg);

    if (ioInstance) {
      ioInstance.to(`hospital_${hospitalId}`).emit('queue_update', { type: 'token_called', token: next });
      ioInstance.emit(`token_${next._id}`, { status: 'Called', tokenNumber: next.tokenNumber });
    }

    res.json({ token: next, message: 'Patient called' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update token status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const hospitalId = req.user.hospitalId || req.user.id;

    const token = await Token.findOne({ _id: req.params.id, hospital: hospitalId });
    if (!token) return res.status(404).json({ error: 'Token not found' });

    token.status = status;
    if (status === 'Done' || status === 'Skipped') token.completedAt = new Date();
    await token.save();

    // Check if reminder should be sent to next patients
    if (status === 'Done') {
      const nextWaiting = await Token.find({
        hospital: hospitalId,
        department: token.department,
        status: 'Waiting'
      }).sort({ createdAt: 1 }).limit(3);

      for (let i = 0; i < nextWaiting.length; i++) {
        const t = nextWaiting[i];
        if (i === 0 && !t.reminderSent) {
          const hospital = await Hospital.findById(hospitalId);
          const msg = whatsapp.templates.reminderMsg(t.patientName, t.tokenNumber, i, hospital?.name || 'Hospital');
          whatsapp.sendWhatsAppMessage(t.phone, msg);
          t.reminderSent = true;
          await t.save();
        }
      }
    }

    if (ioInstance) {
      ioInstance.to(`hospital_${hospitalId}`).emit('queue_update', { type: 'status_update', token });
    }

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get today's history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const hospitalId = req.user.hospitalId || req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tokens = await Token.find({
      hospital: hospitalId,
      createdAt: { $gte: today },
      status: { $in: ['Done', 'Skipped'] }
    }).populate('doctor', 'name').sort({ completedAt: -1 });

    res.json({ tokens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public token status check (patients)
router.get('/check/:tokenId', async (req, res) => {
  try {
    const token = await Token.findById(req.params.tokenId).select('-phone');
    if (!token) return res.status(404).json({ error: 'Token not found' });

    const ahead = await Token.countDocuments({
      hospital: token.hospital,
      department: token.department,
      status: 'Waiting',
      createdAt: { $lt: token.createdAt }
    });

    res.json({ token, patientsAhead: ahead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setIO };
