# AI service (Python / FastAPI + scikit-learn)
FROM python:3.11-slim

WORKDIR /app

COPY backend/ai/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service code and the pre-trained sample model.
COPY backend/ai/ ./

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
