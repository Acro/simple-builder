---
name: Bug report
about: A query builds to the wrong text/values, or an error you didn't expect
title: ''
labels: bug
assignees: ''
---

**What you called**

```javascript
const { pg } = require('simple-builder') // or mysql
pg([ /* your partials */ ])
```

**What you got**

```
{ text: '...', values: [...] }   // or the error message
```

**What you expected**

```
{ text: '...', values: [...] }
```

**Environment**

- simple-builder version:
- Node.js version:
- Driver (pg / mysql / mysql2):
