const { Queue } = require('bullmq');
const connection = require('../config/bullConnection');

const emailQueue = new Queue('emailQueue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400, count: 1000 }
  }
});

const getQueueMetrics = async () => {
  try {
    const counts = await emailQueue.getJobCounts('active', 'completed', 'failed', 'delayed', 'waiting');
    return counts;
  } catch (err) {
    console.error('Error fetching BullMQ queue metrics:', err);
    return { active: 0, completed: 0, failed: 0, delayed: 0, waiting: 0 };
  }
};

module.exports = {
  emailQueue,
  getQueueMetrics
};
