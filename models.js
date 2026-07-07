const mongoose = require('mongoose');

const telemetrySchema = new mongoose.Schema({
  agentId: { type: String, required: true },
  zone: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  metrics: {
    ambient_temp_celsius: Number,
    work_plane_illuminance_lux: Number,
    occupancy_detected: Boolean,
  },
});

telemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

const workOrderSchema = new mongoose.Schema({
  referenceId: { type: String, required: true, unique: true },
  priority: { type: String, enum: ['High', 'Medium', 'Low'], required: true },
  faultType: { type: String, required: true },
  description: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  zone: String,
  zScore: Number,
  repeatCount: { type: Number, default: 1 },
  lastSeenAt: { type: Date, default: Date.now },
  acknowledged: { type: Boolean, default: false },
});

workOrderSchema.index({ zone: 1, faultType: 1, lastSeenAt: -1 });

const Telemetry = mongoose.model('Telemetry', telemetrySchema);
const WorkOrder = mongoose.model('WorkOrder', workOrderSchema);

module.exports = { Telemetry, WorkOrder };
