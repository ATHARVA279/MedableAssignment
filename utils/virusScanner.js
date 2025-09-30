const crypto = require('crypto');
const { logger } = require('./logger');
const config = require('../config');

class VirusScanner {
  async scanFile(fileBuffer, fileName, options = {}) {
    const scanId = crypto.randomUUID();
    const startTime = Date.now();
    
    logger.info('Starting virus scan', { scanId, fileName, size: fileBuffer.length });

    try {
      const result = await this.scanWithVirusTotal(fileBuffer, fileName, { scanId, ...options });
      
      const duration = Date.now() - startTime;
      
      logger.info('Virus scan completed', {
        scanId,
        fileName,
        scanner: 'virustotal',
        duration,
        clean: result.clean,
        threats: result.threats?.length || 0
      });

      return {
        scanId,
        clean: result.clean,
        threats: result.threats || [],
        scanner: 'virustotal',
        duration,
        timestamp: new Date().toISOString(),
        metadata: result.metadata || {}
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Virus scan failed', {
        scanId,
        fileName,
        duration,
        error: error.message
      });
      return {
        scanId,
        clean: false,
        threats: [{ name: 'SCAN_ERROR', description: 'Virus scan failed - file blocked for security' }],
        scanner: 'error',
        duration,
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  async scanWithVirusTotal(fileBuffer, fileName, options = {}) {
    const apiKey = config.security.virusTotalApiKey || process.env.VIRUSTOTAL_API_KEY;
    
    logger.info('VirusTotal scan starting', {
      fileName,
      hasApiKey: !!apiKey,
      apiKeySource: config.security.virusTotalApiKey ? 'config' : 'env',
      fileSize: fileBuffer.length
    });
    
    if (!apiKey) {
      logger.error('VirusTotal API key not found in config or environment');
      throw new Error('VirusTotal API key not configured');
    }

    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    logger.info('File hash calculated', { fileName, fileHash });
    
    try {
      logger.info('Checking VirusTotal for existing scan results', { fileHash });
      
      const hashCheckResponse = await fetch(`https://www.virustotal.com/vtapi/v2/file/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          apikey: apiKey,
          resource: fileHash
        })
      });

      logger.info('VirusTotal hash check response received', { 
        status: hashCheckResponse.status,
        statusText: hashCheckResponse.statusText 
      });

      const hashResult = await hashCheckResponse.json();
      logger.info('VirusTotal hash check result', { 
        responseCode: hashResult.response_code,
        verboseMsg: hashResult.verbose_msg 
      });
      
      if (hashResult.response_code === 1) {
        logger.info('File already exists in VirusTotal database', { 
          fileName, 
          fileHash,
          positives: hashResult.positives,
          total: hashResult.total 
        });
        return this.parseVirusTotalResult(hashResult);
      }

      logger.info('File not found in VirusTotal, uploading for scanning', { fileName, fileHash });
      
      const formData = new FormData();
      formData.append('apikey', apiKey);
      formData.append('file', new Blob([fileBuffer]), fileName);

      const uploadResponse = await fetch('https://www.virustotal.com/vtapi/v2/file/scan', {
        method: 'POST',
        body: formData
      });

      logger.info('VirusTotal upload response received', { 
        status: uploadResponse.status,
        statusText: uploadResponse.statusText 
      });

      const uploadResult = await uploadResponse.json();
      logger.info('VirusTotal upload result', { 
        responseCode: uploadResult.response_code,
        scanId: uploadResult.scan_id,
        verboseMsg: uploadResult.verbose_msg 
      });
      
      if (uploadResult.response_code !== 1) {
        logger.error('VirusTotal upload failed', { 
          responseCode: uploadResult.response_code,
          verboseMsg: uploadResult.verbose_msg 
        });
        throw new Error(`VirusTotal upload failed: ${uploadResult.verbose_msg}`);
      }

      logger.info('Waiting 5 seconds before checking scan results', { scanId: uploadResult.scan_id });
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const reportResponse = await fetch(`https://www.virustotal.com/vtapi/v2/file/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          apikey: apiKey,
          resource: uploadResult.resource
        })
      });

      const reportResult = await reportResponse.json();
      logger.info('VirusTotal final scan result', { 
        responseCode: reportResult.response_code,
        positives: reportResult.positives,
        total: reportResult.total 
      });
      
      return this.parseVirusTotalResult(reportResult);

    } catch (error) {
      logger.error('VirusTotal scan failed with error', { 
        error: error.message,
        fileName,
        fileHash,
        stack: error.stack 
      });
      throw new Error(`VirusTotal scan failed: ${error.message}`);
    }
  }

  parseVirusTotalResult(result) {
    if (result.response_code !== 1) {
      return {
        clean: true,
        threats: [],
        metadata: { status: 'unknown', message: result.verbose_msg }
      };
    }

    const threats = [];
    const positives = result.positives || 0;
    
    if (positives > 0 && result.scans) {
      Object.entries(result.scans).forEach(([engine, scan]) => {
        if (scan.detected) {
          threats.push({
            name: scan.result,
            description: `Detected by ${engine}: ${scan.result}`,
            engine
          });
        }
      });
    }

    return {
      clean: positives === 0,
      threats,
      metadata: {
        positives,
        total: result.total,
        scan_date: result.scan_date,
        permalink: result.permalink
      }
    };
  }

  async scanMultipleFiles(files, options = {}) {
    const results = [];
    const concurrency = options.concurrency || 3;
    
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      
      const batchPromises = batch.map(async (file) => {
        try {
          const result = await this.scanFile(file.buffer, file.name, options);
          return { file: file.name, ...result };
        } catch (error) {
          return {
            file: file.name,
            clean: false,
            threats: [{ name: 'SCAN_ERROR', description: error.message }],
            error: error.message
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }
}

const virusScanner = new VirusScanner();

module.exports = {
  VirusScanner,
  virusScanner
};