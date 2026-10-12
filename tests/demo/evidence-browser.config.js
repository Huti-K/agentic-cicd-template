import config from '../../playwright.config.js';
import {fileURLToPath} from 'node:url';
export default {...config,testDir:'.',testMatch:'evidence-thread.spec.js',outputDir:'../../test-results',webServer:{...config.webServer,cwd:fileURLToPath(new URL('../../',import.meta.url))}};
