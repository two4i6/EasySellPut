import {importInput} from './import';
const [input,db]=process.argv.slice(2);if(!input||!db)throw Error('Expected fixed input and database paths');console.log(JSON.stringify(await importInput(input,db)));
