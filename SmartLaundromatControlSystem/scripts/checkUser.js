require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function checkUser() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/laundromat');

    // Get the raw user from database
    const db = mongoose.connection.db;
    const user = await db.collection('users').findOne({ email: 'admin@laundromat.com' });

    console.log('User found:', user ? 'Yes' : 'No');
    if (user) {
        console.log('Email:', user.email);
        console.log('Password hash:', user.password);
        console.log('Is bcrypt hash:', user.password?.startsWith('$2'));

        // Test password comparison
        const testPassword = 'securepassword';
        const isMatch = await bcrypt.compare(testPassword, user.password);
        console.log('Password "securepassword" matches:', isMatch);
    }

    await mongoose.disconnect();
}

checkUser().catch(console.error);
