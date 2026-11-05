const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs').promises;
const Database = require('better-sqlite3');

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'default_jwt_secret_change_me';
    this.dbPath = path.join(process.cwd(), 'data', 'auth.db');
    this.db = null;
    
    // Default credentials
    this.defaultUsername = 'admin';
    this.defaultPassword = 'admin';
  }

  async init() {
    try {
      // Ensure data directory exists
      await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
      
      // Initialize SQLite database
      this.db = new Database(this.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          is_first_login INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      
      // Check if admin user exists, if not create default
      const existingUser = this.db.prepare('SELECT * FROM users WHERE id = 1').get();
      if (!existingUser) {
        const hashedPassword = await bcrypt.hash(this.defaultPassword, 10);
        const now = Date.now();
        this.db.prepare(
          'INSERT INTO users (username, password_hash, is_first_login, created_at, updated_at) VALUES (?, ?, 1, ?, ?)'
        ).run(this.defaultUsername, hashedPassword, now, now);
        console.log('Default admin user created (admin/admin)');
      }
      
      console.log('Auth service initialized with SQLite');
    } catch (error) {
      console.error('Failed to initialize auth service:', error);
      throw error;
    }
  }

  /**
   * Authenticate user with username and password
   * @param {string} username 
   * @param {string} password 
   * @returns {Promise<{success: boolean, token?: string, isFirstLogin?: boolean, username?: string, message?: string}>}
   */
  async login(username, password) {
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      
      if (!user) {
        return { success: false, message: 'Invalid credentials' };
      }

      const isValid = await bcrypt.compare(password, user.password_hash);
      
      if (!isValid) {
        return { success: false, message: 'Invalid credentials' };
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username, role: 'admin' },
        this.jwtSecret,
        { expiresIn: '24h' }
      );

      return { 
        success: true, 
        token,
        username: user.username,
        isFirstLogin: user.is_first_login === 1
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'Authentication failed' };
    }
  }

  /**
   * Verify JWT token
   * @param {string} token 
   * @returns {object|null} Decoded token or null if invalid
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get user profile
   * @param {number} userId 
   * @returns {object|null}
   */
  getUserProfile(userId = 1) {
    try {
      const user = this.db.prepare('SELECT id, username, is_first_login, created_at, updated_at FROM users WHERE id = ?').get(userId);
      if (user) {
        return {
          id: user.id,
          username: user.username,
          isFirstLogin: user.is_first_login === 1,
          createdAt: user.created_at,
          updatedAt: user.updated_at
        };
      }
      return null;
    } catch (error) {
      console.error('Get profile error:', error);
      return null;
    }
  }

  /**
   * Update user credentials
   * @param {number} userId 
   * @param {string} currentPassword 
   * @param {string} newUsername 
   * @param {string} newPassword 
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async updateCredentials(userId, currentPassword, newUsername, newPassword) {
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Verify current password
      const isValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValid) {
        return { success: false, message: 'Current password is incorrect' };
      }

      // Check if new username is taken by another user
      if (newUsername !== user.username) {
        const existingUser = this.db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, userId);
        if (existingUser) {
          return { success: false, message: 'Username already taken' };
        }
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const now = Date.now();

      // Update user - also mark as no longer first login
      this.db.prepare(
        'UPDATE users SET username = ?, password_hash = ?, is_first_login = 0, updated_at = ? WHERE id = ?'
      ).run(newUsername, hashedPassword, now, userId);

      return { success: true, message: 'Credentials updated successfully' };
    } catch (error) {
      console.error('Failed to update credentials:', error);
      return { success: false, message: 'Failed to update credentials' };
    }
  }

  /**
   * Force mark first login as complete (without changing password)
   * @param {number} userId 
   * @returns {boolean}
   */
  markFirstLoginComplete(userId = 1) {
    try {
      this.db.prepare('UPDATE users SET is_first_login = 0, updated_at = ? WHERE id = ?').run(Date.now(), userId);
      return true;
    } catch (error) {
      console.error('Failed to mark first login complete:', error);
      return false;
    }
  }
}

// Export singleton instance
const authService = new AuthService();



module.exports = authService;
