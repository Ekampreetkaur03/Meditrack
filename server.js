require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const { router: queueRouter, setIO: setQueueIO } = require('./routes/queue');
const staffRoutes = require('./routes/staff');
const whatsapp = require('./whatsapp');
const { authMiddleware } = require('./middleware');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/auth', authRoutes);
app.use('/api/queue', queueRouter);
app.use('/api/staff', staffRoutes);

app.get('/api/whatsapp/status', (req, res) => {
  res.json(whatsapp.getStatus());
});

app.get('/api/whatsapp/qr', (req, res) => {
  const qr = whatsapp.getQR();
  if (qr) res.json({ qr });
  else res.json({ qr: null, status: whatsapp.getStatus() });
});

app.post('/api/whatsapp/test', authMiddleware, async (req, res) => {
  const { phone, message } = req.body;
  const result = await whatsapp.sendWhatsAppMessage(
    phone || process.env.WHATSAPP_OWNER,
    message || 'MediTrack test message ✅'
  );
  res.json(result);
});

app.post('/api/ambulance', async (req, res) => {
  try {
    const { phone, name, location } = req.body;
    const ownerPhone = process.env.WHATSAPP_OWNER;
    if (ownerPhone) {
      await whatsapp.sendWhatsAppMessage(
        ownerPhone,
        `🚑 Ambulance Request\nName: ${name || 'Patient'}\nPhone: ${phone || 'Not provided'}\nLocation: ${location || 'Not provided'}`
      );
    }
    res.json({ message: 'Ambulance request received' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics', authMiddleware, async (req, res) => {
  try {
    const { Token } = require('./models');
    const hospitalId = req.user.hospitalId || req.user.id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayTotal, todayDone, todayWaiting, todayCalled, byDept] = await Promise.all([
      Token.countDocuments({ hospital: hospitalId, createdAt: { $gte: today } }),
      Token.countDocuments({ hospital: hospitalId, createdAt: { $gte: today }, status: 'Done' }),
      Token.countDocuments({ hospital: hospitalId, status: 'Waiting' }),
      Token.countDocuments({ hospital: hospitalId, status: 'Called' }),
      Token.aggregate([
        {
          $match: {
            hospital: mongoose.Types.ObjectId.createFromHexString(hospitalId.toString()),
            createdAt: { $gte: today }
          }
        },
        { $group: { _id: '$department', count: { $sum: 1 } } }
      ])
    ]);

    res.json({ todayTotal, todayDone, todayWaiting, todayCalled, byDept });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_hospital', (hospitalId) => {
    socket.join(`hospital_${hospitalId}`);
    console.log(`Socket ${socket.id} joined hospital_${hospitalId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

setQueueIO(io);
whatsapp.setIO(io);

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MongoDB connection error: MONGODB_URI missing in .env');
} else {
  mongoose.connect(MONGODB_URI)
    .then(() => {
      console.log('✅ MongoDB connected');
      whatsapp.connectWhatsApp().catch(console.error);
    })
    .catch(err => {
      console.error('MongoDB connection error:', err.message);
      whatsapp.connectWhatsApp().catch(console.error);
    });
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`\n🏥 MediTrack Server running on port ${PORT}`);
  console.log(`📱 WhatsApp owner: ${process.env.WHATSAPP_OWNER || 'Not set'}`);
  console.log(`🌐 Open: http://localhost:${PORT}\n`);
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.originalUrl });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

module.exports = { app, io };
