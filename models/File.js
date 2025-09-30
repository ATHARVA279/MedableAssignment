const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const fileSchema = new mongoose.Schema(
  {
    fileId: {
      type: String,
      required: true,
      unique: true,
      default: () => `file-${uuidv4().substring(0, 8)}`,
    },

    originalName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },

    cloudinaryUrl: {
      type: String,
      required: true,
    },

    cloudinaryPublicId: {
      type: String,
      required: true,
      unique: true,
    },

    size: {
      type: Number,
      required: true,
      min: 0,
    },

    mimetype: {
      type: String,
      required: true,
      enum: [
        "image/jpeg",
        "image/png",
        "application/pdf",
        "text/csv",
        "image/gif",
        "image/webp",
      ],
    },
    
    uploaderId: {
      type: String,
      required: true,
      index: true,
    },

    status: {
      type: String,
      required: true,
      enum: ["uploaded", "processing", "processed", "failed", "deleted"],
      default: "uploaded",
      index: true,
    },

    publicAccess: {
      type: Boolean,
      default: false,
      index: true,
    },

    processingResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    tags: [
      {
        type: String,
        trim: true,
        maxlength: 50,
      },
    ],

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    encryptionMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    version: {
      type: Number,
      default: 1,
      min: 1,
    },

    parentFileId: {
      type: String,
      default: null,
    },

    shareToken: {
      type: String,
      default: null,
    },

    shareExpiry: {
      type: Date,
      default: null,
    },

    sharePassword: {
      type: String,
      default: null,
    },

    downloadCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastAccessed: {
      type: Date,
      default: null,
    },

    virusScanResult: {
      clean: {
        type: Boolean,
        default: null,
      },
      scanner: {
        type: String,
        default: null,
      },
      scanDate: {
        type: Date,
        default: null,
      },
      threats: [
        {
          name: String,
          severity: String,
        },
      ],
    },

    backupStatus: {
      type: String,
      enum: ["pending", "backed_up", "failed", "not_required"],
      default: "pending",
    },

    lastBackup: {
      type: Date,
      default: null,
    },

    deletedCloudinaryPublicId: {
      type: String,
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret._id;
        delete ret.__v;
        delete ret.sharePassword;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

fileSchema.index({ uploaderId: 1, createdAt: -1 });
fileSchema.index({ status: 1, createdAt: -1 });
fileSchema.index({ publicAccess: 1, status: 1 });
fileSchema.index({ mimetype: 1, status: 1 });
fileSchema.index({ tags: 1 });
fileSchema.index(
  { shareToken: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { shareToken: { $ne: null } },
  }
);
fileSchema.index({ parentFileId: 1 }, { sparse: true });

fileSchema.virtual("secureUrl").get(function () {
  return this.cloudinaryUrl;
});

fileSchema.virtual("age").get(function () {
  return Date.now() - this.createdAt.getTime();
});

fileSchema.virtual("humanSize").get(function () {
  const bytes = this.size;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
});

fileSchema.pre("save", function (next) {
  if (this.isModified("downloadCount")) {
    this.lastAccessed = new Date();
  }

  if (!this.fileId) {
    this.fileId = `file-${uuidv4().substring(0, 8)}`;
  }

  next();
});

fileSchema.statics.findByUploader = function (uploaderId, options = {}) {
  const query = { uploaderId, status: { $ne: "deleted" } };

  let mongoQuery = this.find(query);

  if (options.status) {
    mongoQuery = mongoQuery.where("status", options.status);
  }

  if (options.mimetype) {
    mongoQuery = mongoQuery.where("mimetype", options.mimetype);
  }

  if (options.publicAccess !== undefined) {
    mongoQuery = mongoQuery.where("publicAccess", options.publicAccess);
  }

  if (options.limit) {
    mongoQuery = mongoQuery.limit(options.limit);
  }

  if (options.skip) {
    mongoQuery = mongoQuery.skip(options.skip);
  }

  return mongoQuery.sort({ createdAt: -1 });
};

fileSchema.statics.findPublicFiles = function (options = {}) {
  const query = { publicAccess: true, status: "processed" };

  let mongoQuery = this.find(query);

  if (options.mimetype) {
    mongoQuery = mongoQuery.where("mimetype", options.mimetype);
  }

  if (options.limit) {
    mongoQuery = mongoQuery.limit(options.limit);
  }

  if (options.skip) {
    mongoQuery = mongoQuery.skip(options.skip);
  }

  return mongoQuery.sort({ createdAt: -1 });
};

fileSchema.statics.searchFiles = function (
  searchTerm,
  uploaderId = null,
  options = {}
) {
  const searchRegex = new RegExp(searchTerm, "i");

  let query = {
    status: { $ne: "deleted" },
    $or: [
      { originalName: searchRegex },
      { description: searchRegex },
      { tags: { $in: [searchRegex] } },
    ],
  };

  if (uploaderId) {
    query.uploaderId = uploaderId;
  } else {
    query.publicAccess = true;
  }

  let mongoQuery = this.find(query);

  if (options.limit) {
    mongoQuery = mongoQuery.limit(options.limit);
  }

  if (options.skip) {
    mongoQuery = mongoQuery.skip(options.skip);
  }

  return mongoQuery.sort({ createdAt: -1 });
};

fileSchema.methods.incrementDownload = function () {
  this.downloadCount += 1;
  this.lastAccessed = new Date();
  return this.save();
};

fileSchema.methods.updateProcessingStatus = function (status, result = null) {
  this.status = status;
  if (result) {
    this.processingResult = result;
  }
  return this.save();
};

fileSchema.methods.softDelete = function (deletedCloudinaryPublicId = null) {
  this.status = "deleted";
  this.deletedAt = new Date();
  if (deletedCloudinaryPublicId) {
    this.deletedCloudinaryPublicId = deletedCloudinaryPublicId;
  }
  return this.save();
};

fileSchema.methods.restore = function (restoredCloudinaryPublicId = null) {
  this.status = "processed"; // or whatever the previous status was
  this.deletedAt = null;
  if (restoredCloudinaryPublicId) {
    this.cloudinaryPublicId = restoredCloudinaryPublicId;
  }
  this.deletedCloudinaryPublicId = null;
  return this.save();
};

fileSchema.methods.createShareToken = function (
  expiryHours = 24,
  password = null
) {
  this.shareToken = uuidv4();
  this.shareExpiry = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
  if (password) {
    const crypto = require("crypto");
    this.sharePassword = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");
  }
  return this.save();
};

fileSchema.methods.isShareValid = function () {
  if (!this.shareToken) return false;
  if (this.shareExpiry && this.shareExpiry < new Date()) return false;
  return true;
};

const File = mongoose.model("File", fileSchema);

module.exports = File;
