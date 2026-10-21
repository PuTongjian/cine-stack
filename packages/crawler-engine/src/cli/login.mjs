import { loginSuenen } from '../suenen/login.mjs';
loginSuenen({ username: process.env.SUENEN_USERNAME, password: process.env.SUENEN_PASSWORD })
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
