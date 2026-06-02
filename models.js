const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Hospital Model
const hospitalSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  departments: [{ type: String }],
  avgConsultationTime: { type: Number, default: 10 },
  createdAt: { type: Date, default: Date.now }
});

hospitalSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

hospitalSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

// User Model
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'receptionist', 'doctor'], required: true },
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  department: { type: String },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

// Token Model
const tokenSchema = new mongoose.Schema({
  tokenNumber: { type: Number, required: true },
  patientName: { type: String, required: true },
  phone: { type: String, required: true },
  age: { type: Number },
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  department: { type: String, required: true },
  priority: { type: String, enum: ['Normal', 'Urgent', 'Emergency'], default: 'Normal' },
  status: { type: String, enum: ['Waiting', 'Called', 'In-Progress', 'Done', 'Skipped'], default: 'Waiting' },
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String },
  whatsappSent: { type: Boolean, default: false },
  reminderSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  calledAt: { type: Date },
  completedAt: { type: Date }
});

// Doctor Status Model
const doctorStatusSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  isAvailable: { type: Boolean, default: true },
  currentPatient: { type: mongoose.Schema.Types.ObjectId, ref: 'Token' },
  department: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = {
  Hospital: mongoose.model('Hospital', hospitalSchema),
  User: mongoose.model('User', userSchema),
  Token: mongoose.model('Token', tokenSchema),
  DoctorStatus: mongoose.model('DoctorStatus', doctorStatusSchema)
};