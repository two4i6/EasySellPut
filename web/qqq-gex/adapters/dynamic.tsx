import React, {lazy,Suspense} from 'react';
export default function dynamic(load:any, options:any={}) {const Component=lazy(load);return function Deferred(props:any){return <Suspense fallback={options.loading ? React.createElement(options.loading) : null}><Component {...props}/></Suspense>;};}
