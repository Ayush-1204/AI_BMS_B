const mongoose = require('mongoose');
const { Telemetry, WorkOrder } = require('../models');

async function reset() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/arborBMS';

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

    const tResult = await Telemetry.deleteMany({});
    const wResult = await WorkOrder.deleteMany({});

    console.log(
      `[${new Date().toISOString()}] [RESET] ` +
        `Cleared ${tResult.deletedCount} telemetry docs, ${wResult.deletedCount} work orders.`
    );
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] [RESET] Failed — is mongod running? ${err.message}`
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

reset();

