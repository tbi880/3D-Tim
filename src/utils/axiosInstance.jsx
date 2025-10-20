import axios from 'axios';
import { authURL } from "../Settings";

const instance = axios.create({
    baseURL: authURL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 15000,
});

export default instance;
