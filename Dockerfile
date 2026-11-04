# Multi-stage build for MongoDB Backup Manager

# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./

# Install dependencies
RUN npm ci --quiet

# Copy client source
COPY client/ ./

# Build frontend
RUN npm run build

# Stage 2: Extract mysqlbinlog (only shipped in the full mariadb package on Alpine)
FROM node:18-alpine AS binlog-tools
RUN apk add --no-cache mariadb

# Stage 3: Final image
FROM node:18-alpine

# Install database backup tools and timezone data
# mongodb-tools: mongodump/mongorestore
# mariadb-client: mysqldump/mariadb-dump, mysql/mariadb
RUN apk add --no-cache mongodb-tools mariadb-client tzdata

# mysqlbinlog for MySQL incremental backups (copied to keep the image small)
COPY --from=binlog-tools /usr/bin/mariadb-binlog /usr/bin/mariadb-binlog
RUN ln -s /usr/bin/mariadb-binlog /usr/bin/mysqlbinlog

# Set default timezone (can be overridden by TZ environment variable)
ENV TZ=Asia/Kolkata

WORKDIR /app

# Copy server package files
COPY server/package*.json ./server/

# Install production dependencies
WORKDIR /app/server
RUN npm ci --production --quiet

# Copy server source
COPY server/ ./

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/client/dist /app/client/dist

# Create data directories
RUN mkdir -p /app/data/backups /app/logs

# Set environment to production
ENV NODE_ENV=production

# Expose port
EXPOSE 5552 5551

# Start server
CMD ["node", "index.js"]
