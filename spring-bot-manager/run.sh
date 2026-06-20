#!/bin/sh

# Default JVM options
DEFAULT_JAVA_OPTS="-Xms256m -Xmx512m -XX:+UseG1GC -XX:+HeapDumpOnOutOfMemoryError"

# Merge default with custom options
JAVA_OPTS="${DEFAULT_JAVA_OPTS} ${JAVA_OPTS}"

# Log startup info
echo "Starting spring-bot-manager..."
echo "JAVA_OPTS: ${JAVA_OPTS}"
echo "SPRING_PROFILES_ACTIVE: ${SPRING_PROFILES_ACTIVE:-default}"

# Run the application
exec java ${JAVA_OPTS} -jar /app/app.jar
