FROM python:3.11-slim

WORKDIR /tests

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy test files
COPY tests/ tests/
COPY libraries/ libraries/

# Run tests
CMD ["robot", "--outputdir", "/results", "tests/"]
