import {readFileSync} from 'node:fs';import {projectQqqGexDisplayPayload} from 'source:qqq-pcs';
const input=JSON.parse(readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(projectQqqGexDisplayPayload(input,process.argv[3]??null,input.intraday?.bars)));
