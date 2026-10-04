process.env.REACT_APP_DEMO_MODE = 'true';
const secureDemo = process.argv.includes('--https');
process.env.PORT = secureDemo ? '3003' : '3001';
if (secureDemo) process.env.HTTPS = 'true';
process.env.BROWSER = 'none';

require('react-scripts/scripts/start');
