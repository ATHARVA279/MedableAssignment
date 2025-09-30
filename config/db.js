const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

class DatabaseConnection {
  constructor() {
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000;
  }

  async connect() {
    try {
      const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/file_uploads';
      
      const options = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
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
        console.log(`Retrying connection in ${this.retryDelay / 1000} seconds...`);
        setTimeout(() => this.connect(), this.retryDelay);
      } else {
        console.error('Max connection attempts reached. Exiting...');
        process.exit(1);
      }
      
      return false;
    }
  }

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

  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { healthy: false, message: 'Not connected to database' };
      }

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

const dbConnection = new DatabaseConnection();

module.exports = {
  DatabaseConnection,
  dbConnection,
  mongoose
};