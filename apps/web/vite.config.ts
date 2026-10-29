import { defineConfig } from 'vite';
const apiPort=process.env.VITE_API_PORT??'3000';
export default defineConfig({server:{proxy:{'/api':`http://127.0.0.1:${apiPort}`,'/ws':{target:`ws://127.0.0.1:${apiPort}`,ws:true}}}});
