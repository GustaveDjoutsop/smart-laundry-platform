require('dotenv').config();
const axios = require('axios');

const testCampayAuth = async () => {
    console.log('Testing Campay Authentication...');
    console.log('CAMPAY_APP_KEY:', process.env.CAMPAY_APP_KEY);
    console.log('CAMPAY_APP_SECRET:', process.env.CAMPAY_APP_SECRET);

    try {
        const response = await axios.post('https://www.campay.net/api/token/', {
            username: process.env.CAMPAY_APP_KEY,
            password: process.env.CAMPAY_APP_SECRET
        });
        console.log('✅ Authentication successful!');
        console.log('Token:', response.data.token);
    } catch (error) {
        console.error('❌ Authentication failed:');
        console.error('Status:', error.response?.status);
        console.error('Data:', JSON.stringify(error.response?.data, null, 2));
    }
};

testCampayAuth();
