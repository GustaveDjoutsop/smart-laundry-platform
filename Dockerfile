# Use the official Node.js 20 image, matching your project's engine requirement
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install all dependencies, including devDependencies for development
RUN npm install

# Copy the Prisma schema to generate the client
COPY prisma ./prisma/

# Generate the Prisma client
RUN npx prisma generate

# Copy the rest of your application's source code
COPY . .

# The app will run on port 3000, so we expose it
EXPOSE 3000

# The command to run when the container starts for development.
# We use nodemon to automatically restart on file changes.
CMD ["npm", "run", "dev"]