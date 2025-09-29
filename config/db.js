const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

/**
 * MongoDB Connection Configuration
 */
class DatabaseConnection {
  constructor() {
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      const mongoUri = process.env.MONGO_URI;
      
      // MongoDB connection options (updated for newer Mongoose versions)
      const options = {
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      };

      await mongoose.connect(mongoUri, options);
      
      this.isConnected = true;
      this.connectionAttempts = 0;
      
      console.log('MongoDB connected successfully');
      
      return true;
    } catch (error) {
      this.isConnected = false;
      this.connectionAttempts++;
      
      logger.error('MongoDB connection failed', {
        error: error.message,
        attempt: this.connectionAttempts,
        maxRetries: this.maxRetries
      });
      
      console.error('MongoDB connection failed:', error.message);
      
      if (this.connectionAttempts < this.maxRetries) {
        console.log(`🔄 Retrying connection in ${this.retryDelay / 1000} seconds...`);
        setTimeout(() => this.connect(), this.retryDelay);
      } else {
        console.error('Max connection attempts reached.');
        process.exit(1);
      }
      
      return false;
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    try {
      await mongoose.disconnect();
      this.isConnected = false;
      
      logger.info('MongoDB disconnected successfully');
      console.log('MongoDB disconnected');
      
      return true;
    } catch (error) {
      logger.error('MongoDB disconnection failed', { error: error.message });
      console.error('MongoDB disconnection failed:', error.message);
      return false;
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      connectionAttempts: this.connectionAttempts
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { healthy: false, message: 'Not connected to database' };
      }

      // Ping the database
      await mongoose.connection.db.admin().ping();
      
      return {
        healthy: true,
        message: 'Database connection healthy',
        status: this.getStatus()
      };
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return {
        healthy: false,
        message: 'Database health check failed',
        error: error.message
      };
    }
  }
}

// Connection event handlers
mongoose.connection.on('connected', () => {
  logger.info('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (error) => {
  logger.error('Mongoose connection error', { error: error.message });
});

mongoose.connection.on('disconnected', () => {
  logger.warn('Mongoose disconnected from MongoDB');
});

// Handle application termination
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    logger.info('Mongoose connection closed through app termination');
    process.exit(0);
  } catch (error) {
    logger.error('Error closing mongoose connection', { error: error.message });
    process.exit(1);
  }
});

// Global database connection instance
const dbConnection = new DatabaseConnection();

module.exports = {
  DatabaseConnection,
  dbConnection,
  mongoose
};