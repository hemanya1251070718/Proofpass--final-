# ==============================================================================
# Stage 1: Build Frontend (Vite + React)
# ==============================================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Production Python Backend & SPA Host
# ==============================================================================
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies needed for native Python packages and health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source. backend/data holds ONLY the optional course dataset (see .dockerignore);
# when it is not in the build context (it is not committed), set COURSE_CSV_URL and it is fetched at start-up.
COPY backend/ ./backend/
COPY .env.example ./

# Copy built frontend assets from Stage 1 into frontend/dist
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Default environment variables
ENV PYTHONUNBUFFERED=1 \
    PORT=10000 \
    INTELLIGENCE_FALLBACK_TO_MOCK=true

EXPOSE 10000

# Start Uvicorn ASGI server bound to 0.0.0.0 on Render's dynamic $PORT
# Start-up: make the course catalogue available (never fails the container), then serve.
CMD ["sh", "-c", "python -m backend.recommendations.course_import --startup; exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
