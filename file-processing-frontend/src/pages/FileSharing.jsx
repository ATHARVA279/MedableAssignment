import { useState, useEffect } from 'react'
import { apiClient } from '../services/apiClient'
import toast from 'react-hot-toast'

const FileSharing = () => {
  const [shareLinks, setShareLinks] = useState([])
  const [loading, setLoading] = useState(false)
  const [createForm, setCreateForm] = useState({
    fileId: '',
    expiresIn: '24h',
    password: '',
    maxDownloads: '',
    allowPreview: true
  })

  useEffect(() => {
    loadShareLinks()
  }, [])

  const loadShareLinks = async () => {
    try {
      const response = await apiClient.get('/api/sharing')
      setShareLinks(response.data.shareLinks || [])
    } catch (error) {
      console.error('Failed to load share links:', error)
    }
  }

  const createShareLink = async (e) => {
    e.preventDefault()
    if (!createForm.fileId.trim()) {
      toast.error('Please enter a file ID')
      return
    }

    setLoading(true)
    try {
      const payload = {
        expiresIn: createForm.expiresIn,
        allowPreview: createForm.allowPreview
      }

      if (createForm.password) payload.password = createForm.password
      if (createForm.maxDownloads) payload.maxDownloads = parseInt(createForm.maxDownloads)

      const response = await apiClient.post(`/api/sharing/${createForm.fileId}`, payload)

      toast.success('Share link created successfully!')
      setCreateForm({
        fileId: '',
        expiresIn: '24h',
        password: '',
        maxDownloads: '',
        allowPreview: true
      })
      loadShareLinks()
    } catch (error) {
      toast.error(`Failed to create share link: ${error.response?.data?.error || error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Link copied to clipboard!')
    }).catch(() => {
      toast.error('Failed to copy link')
    })
  }

  const deleteShareLink = async (token) => {
    if (!confirm('Are you sure you want to delete this share link?')) return

    try {
      await apiClient.delete(`/api/sharing/${token}`)
      toast.success('Share link deleted')
      loadShareLinks()
    } catch (error) {
      toast.error(`Failed to delete share link: ${error.response?.data?.error || error.message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h1 className="card-title">
            <i className="fas fa-share-alt"></i>
            File Sharing
          </h1>
        </div>
        <p className="text-gray-600 mb-4">
          Create secure share links for your files with expiration dates, passwords, and download limits.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-800 mb-2">
            <i className="fas fa-info-circle"></i> Link Types Explained
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium text-blue-700">Share Link (Tracked)</h4>
              <p className="text-blue-600">
                Goes through our server, tracks downloads, enforces limits and passwords
              </p>
            </div>
            <div>
              <h4 className="font-medium text-green-700">Direct Download Link</h4>
              <p className="text-green-600">
                Downloads directly from Cloudinary, bypasses tracking but works offline
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-info-circle"></i>
            How to Get File ID
          </h2>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-800 mb-2">Steps to Share a File:</h3>
          <ol className="list-decimal list-inside space-y-2 text-blue-700">
            <li>Go to the <strong>File Manager</strong> page</li>
            <li>Find the file you want to share</li>
            <li>Copy the <strong>File ID</strong> (e.g., file-abc123)</li>
            <li>Paste it in the "File ID to Share" field below</li>
            <li>Configure your sharing settings and create the link</li>
          </ol>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-plus"></i>
            Create Share Link
          </h2>
        </div>

        <form onSubmit={createShareLink} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-group">
              <label className="form-label">File ID to Share *</label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter file ID (e.g., file-abc123)"
                value={createForm.fileId}
                onChange={(e) => setCreateForm(prev => ({ ...prev, fileId: e.target.value }))}
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                <i className="fas fa-info-circle"></i> Get the file ID from the File Manager page
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Expires In</label>
              <select
                className="form-select"
                value={createForm.expiresIn}
                onChange={(e) => setCreateForm(prev => ({ ...prev, expiresIn: e.target.value }))}
              >
                <option value="1h">1 Hour</option>
                <option value="24h">24 Hours</option>
                <option value="7d">7 Days</option>
                <option value="30d">30 Days</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Password (Optional)</label>
              <input
                type="password"
                className="form-input"
                placeholder="Set password protection"
                value={createForm.password}
                onChange={(e) => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Max Downloads (Optional)</label>
              <input
                type="number"
                className="form-input"
                placeholder="Limit number of downloads"
                value={createForm.maxDownloads}
                onChange={(e) => setCreateForm(prev => ({ ...prev, maxDownloads: e.target.value }))}
                min="1"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="allowPreview"
              checked={createForm.allowPreview}
              onChange={(e) => setCreateForm(prev => ({ ...prev, allowPreview: e.target.checked }))}
              className="w-4 h-4"
            />
            <label htmlFor="allowPreview" className="font-medium">
              Allow file preview
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
          >
            <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-share'}`}></i>
            {loading ? 'Creating...' : 'Create Share Link'}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-link"></i>
            My Share Links
          </h2>
          <button onClick={loadShareLinks} className="btn btn-outline">
            <i className="fas fa-sync"></i>
            Refresh
          </button>
        </div>

        {shareLinks.length === 0 ? (
          <div className="text-center py-8">
            <i className="fas fa-share-alt text-gray-300 text-4xl mb-4"></i>
            <p className="text-gray-500">No share links created yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {shareLinks.map((link) => (
              <div key={link.token} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-medium text-gray-800">{link.fileName}</h3>
                    <p className="text-sm text-gray-500">File ID: {link.fileId}</p>
                  </div>
                  <span className={`badge ${link.isActive ? 'badge-success' : 'badge-error'}`}>
                    {link.isActive ? 'Active' : 'Expired'}
                  </span>
                </div>

                <div className="bg-gray-50 p-3 rounded-lg mb-3 space-y-2">
                  <div>
                    <label className="text-xs text-gray-600 font-medium">Share Link (with tracking):</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm bg-white p-2 rounded border">
                        {window.location.origin}/api/sharing/download/{link.token}
                      </code>
                      <button
                        onClick={() => copyToClipboard(`${window.location.origin}/api/sharing/download/${link.token}`)}
                        className="btn btn-sm btn-outline"
                      >
                        <i className="fas fa-copy"></i>
                      </button>
                    </div>
                  </div>
                  {link.directUrl && (
                    <div>
                      <label className="text-xs text-gray-600 font-medium">
                        Direct Download Link {link.mimetype === 'application/pdf' ? '(PDF Download)' : ''}:
                      </label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm bg-green-50 p-2 rounded border border-green-200">
                          {link.directUrl}
                        </code>
                        <button
                          onClick={() => copyToClipboard(link.directUrl)}
                          className="btn btn-sm btn-success"
                          title="Copy direct download link"
                        >
                          <i className="fas fa-copy"></i>
                        </button>
                        <a
                          href={link.directUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm btn-primary"
                          title="Download file directly"
                        >
                          <i className="fas fa-download"></i>
                        </a>
                      </div>
                      <p className="text-xs text-green-600 mt-1">
                        <i className="fas fa-check-circle"></i>
                        This link will download the file directly to your computer
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                  <div>
                    <span className="text-gray-600">Expires:</span>
                    <div className="font-medium">
                      {new Date(link.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Downloads:</span>
                    <div className="font-medium">
                      {link.downloadCount} / {link.maxDownloads || '∞'}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Protected:</span>
                    <div className="font-medium">
                      {link.hasPassword ? 'Yes' : 'No'}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">Preview:</span>
                    <div className="font-medium">
                      {link.allowPreview ? 'Enabled' : 'Disabled'}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => copyToClipboard(`${window.location.origin}/api/sharing/download/${link.token}`)}
                    className="btn btn-sm btn-outline"
                  >
                    <i className="fas fa-copy"></i>
                    Copy Share Link
                  </button>
                  {link.directUrl && (
                    <>
                      <button
                        onClick={() => copyToClipboard(link.directUrl)}
                        className="btn btn-sm btn-primary"
                      >
                        <i className="fas fa-link"></i>
                        Copy Direct Link
                      </button>
                      <a
                        href={link.directUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-success"
                      >
                        <i className="fas fa-download"></i>
                        Download Now
                      </a>
                    </>
                  )}
                  {link.allowPreview && (
                    <button
                      onClick={() => copyToClipboard(`${window.location.origin}/api/sharing/preview/${link.token}`)}
                      className="btn btn-sm btn-info"
                    >
                      <i className="fas fa-eye"></i>
                      Preview Link
                    </button>
                  )}
                  <button
                    onClick={() => deleteShareLink(link.token)}
                    className="btn btn-sm btn-danger"
                  >
                    <i className="fas fa-trash"></i>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default FileSharing