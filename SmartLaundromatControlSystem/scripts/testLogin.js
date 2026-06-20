/**
 * Test login functionality in the same way as the server
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function testLogin() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/laundromat');
    console.log('Connected!\n');

    const email = 'admin@laundromat.com';
    const password = 'securepassword';

    console.log('Testing login with:', email);
    console.log('Password:', password);
    console.log('');

    // Find user exactly like the controller does
    const user = await User.findOne({ email: email.toLowerCase() });

    console.log('User found:', user ? 'yes' : 'no');
    if (!user) {
        console.log('User not found!');
        await mongoose.disconnect();
        return;
    }

    console.log('User email:', user.email);
    console.log('User role:', user.role);
    console.log('User isActive:', user.isActive);
    console.log('Password field exists:', !!user.password);
    console.log('Password hash (first 20 chars):', user.password?.substring(0, 20));
    console.log('');

    // Compare password like the controller does
    console.log('Comparing password...');
    const isMatch = await user.comparePassword(password);
    console.log('Password match:', isMatch);

    await mongoose.disconnect();
    console.log('\nDone!');
}

testLogin().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
