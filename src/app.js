const express = require('express');
const sqlite = require('sqlite3');
const crypto = require('crypto');

const app = express();
const db = new sqlite.Database('data.db');

const asyncFunc = (fn) => {
    return (...args) => {
        return new Promise((res, rej) => {
            fn(...args, (err, data) => { (err) ? rej(err) : res(data); });
        });
    };
}

const asyncExec = asyncFunc((...args) => { db.exec(...args) });
const asyncRun = asyncFunc((...args) => { db.run(...args) });
const asyncAll = asyncFunc((...args) => { db.all(...args) });
const asyncGet = asyncFunc((...args) => { db.get(...args) });

// create table
(async () => {
    await asyncExec(`create table if not exists User (
        userId integer primary key autoincrement, 
        userName text not null unique, 
        passwordHash text not null
        )`);
    await asyncExec(`create table if not exists Entry (
        id integer primary key autoincrement, 
        userId integer not null, 
        title text not null, 
        price integer not null, 
        date integer not null, 
        createdOn integer not null, 
        category text not null, 
        createdBy integer not null, 
        description text
        )`);
    await asyncExec(`create table if not exists Session (
        id text primary key not null, 
        userId integer not null, 
        createdOn int not null
        )`);
    setInterval(async () => {
        await asyncRun('delete from Session where createdOn < datetime("now", "-1 hours")')
    }, 60000);
})();

function generateId(length) {
    alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
    r = '';
    for (i = 0; i < length; i++)
        r += alpha[Math.floor(Math.random() * alpha.length)];
    return r;
}

app.listen(8080, () => { });


app.get('/api/v1/register', async (req, res, next) => {
    if (req.query.userName && req.query.password) {
        const sha = crypto.createHash('sha256');
        sha.update(req.query.password, 'utf8');
        await asyncRun('insert into User values(?,?,?)',
            [
                null,
                req.query.userName,
                sha.digest('hex')
            ]).then(() => {
                console.log('new user:', req.query.userName);
                res.status(200);
                res.end();
            }).catch(() => {
                res.status(400);
                res.end();
            });
    } else {
        res.status(400);
        res.end();
    }
});

app.get('/api/v1/auth', async (req, res, next) => {
    if (req.query.userName && req.query.password) {
        const sha = crypto.createHash('sha256');
        sha.update(req.query.password, 'utf8');
        db.all('select * from User where userName == ? and passwordHash == ?',
            [
                req.query.userName,
                sha.digest('hex')
            ],
            async (err, rows) => {
                if (rows.length == 1) {
                    const sessionId = generateId(100);
                    const now = new Date().getTime();
                    db.run('insert into Session values(?,?,?)',
                        [
                            sessionId,
                            (await getUser(req.query.userName)).userId,
                            now
                        ]
                    );
                    res.status(200);
                    res.end(JSON.stringify({ sessionId, expiresOn: now + 60 * 60 * 1000 }));
                } else {
                    res.status(400);
                    res.end();
                }
            });
    } else {
        res.status(400);
        res.end();
    }
});
app.get('/api/v1/logout', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        const user = await getUser(req.query['userName']);
        if (user) {
            await asyncRun('delete from Session where id == ? and userId == ?', [
                req.query['sessionId'],
                user.userId
            ]).then((data) => {
                res.status(200);
                res.end();
            }).catch((err) => {
                res.status(400);
                res.end();
            });
        }
    }
    res.status(400);
    res.end();
});

app.get('/api/v1/reflesh', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        const user = await getUser(req.query['userName']);
        if (user) {
            const del = await asyncRun('delete from Session where id == ? and userId == ?', [
                req.query['sessionId'],
                user.userId
            ]).then(() => true).catch(() => false);
            if (del) {
                const sessionId = generateId(100);
                const now = new Date().getTime();
                await asyncRun('insert into Session values(?,?,?)',
                    [
                        sessionId,
                        user.userId,
                        now
                    ]
                ).then(() => {
                    res.status(200);
                    res.end(JSON.stringify({ sessionId, expiresOn: now + 60 * 60 * 1000 }));
                }).catch(() => {
                    res.status(400);
                    res.end();
                });
            }
        }
    }
    res.status(400);
    res.end();
});

async function getUser(userName) {
    return asyncGet('select * from User where userName == ?', [userName]).then(data => {
        return data;
    }).catch(err => {
        return null;
    });
}
async function getUserName(userId) {
    return asyncGet('select * from User where userId == ?', [userId]).then(data => {
        return data;
    }).catch(err => {
        console.log(err)
        return null;
    });
}

async function checkSession(userName, sessionId) {
    if (!(userName && sessionId))
        return false;
    return asyncGet('select * from Session where userName == ? and id == ? and createdOn > datetime("now","-1 hours")', [userName, sessionId]).then((data) => {
        return !!data;
    }).catch(() => {
        return false;
    });
}

app.use('/api/v1/entry', express.json());
app.use('/api/v1/entry', express.urlencoded({ extended: true }));

app.post('/api/v1/entry', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        const userId = (await getUser(req.query['userName'])).userId;
        await asyncRun('insert into Entry values(?,?,?,?,?,?,?,?,?)',
            [
                null,
                userId,
                req.body.title,
                req.body.price,
                req.body.date,
                new Date().getTime(),
                req.body.category || "",
                userId,
                req.body.description,
            ]
        ).then(data => {
            res.status(200);
            res.end();
        }).catch(err => {
            res.status(400);
            res.end();
            console.log(err)
        });
    } else {
        res.status(400);
        res.end();
    }
});

app.get('/api/v1/entry', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        if (req.query['year'] && req.query['month']) {
            await asyncAll('select * from Entry where userId == ? and date >= ? and date < ?',
                [
                    (await getUser(req.query['userName'])).userId,
                    new Date(Number(req.query['year']), Number(req.query['month']) - 1, 1).getTime(),
                    new Date(Number(req.query['year']), Number(req.query['month']), 1).getTime(),
                ]
            ).then(data => {
                res.status(200);
                res.end(JSON.stringify(data));
            }).catch(err => {
                console.log(err);
                res.status(400);
                res.end();
            });
        }
    }
    res.status(400);
    res.end();
});
app.get('/api/v1/entry/all', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        const user = await getUser(req.query['userName']);
        if (user) {
            await asyncAll('select * from Entry where userId == ?',
                [
                    user.userId,
                ]
            ).then(data => {
                res.status(200);
                res.end(JSON.stringify(data));
            }).catch(err => {
                res.status(400);
                res.end();
            });
        }
    }
    res.status(400);
    res.end();
});
app.delete('/api/v1/entry', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        if ('id' in req.query) {
            await asyncRun('delete from Entry where id == ?',
                [
                    req.query['id']
                ]
            ).then(data => {
                res.status(200);
                res.end();
            }).catch(err => {
                res.status(400);
                res.end();
                console.log(err)
            });
        }
    }
    res.status(400);
    res.end();
});

async function getCategories(userId) {
    return await asyncAll('select distinct category from Entry where userId == ?',
        [
            userId
        ]);
}

app.get('/api/v1/category', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        const user = await getUser(req.query['userName']);
        getCategories(user.userId).then(data => {
            if (data) {
                res.status(200);
                res.end(JSON.stringify({ categories: data.map(e => e.category) }));
            } else {
                res.status(400);
                res.end();
            }
        }).catch(err => {
            res.status(400);
            res.end();
        });
    } else {
        res.status(400);
        res.end();
    }
});

app.get('/api/v1/userName', async (req, res, next) => {
    // TODO:チェック
    res.status(200);
    const user = await getUserName(req.query['userId']);
    res.end(JSON.stringify({ userName: user && user.userName }));
});

app.get('/api/v1/available/userName', async (req, res, next) => {
    const user = await getUser(req.query['userName']);
    res.status(200);
    res.end(JSON.stringify({
        available: !user
    }));
});
app.get('/api/v1/available/password', async (req, res, next) => {
    const password = req.query['password'];
    res.status(200);
    res.end(JSON.stringify({
        available: password.length >= 8
    }));
});

app.get('/api/v1/month', async (req, res, next) => {
    if (checkSession(req.query['sessionId'], req.query['userName'])) {
        const user = await getUser(req.query['userName']);
        if (user && req.query['year'] && req.query['month']) {
            const monthHead = new Date(Number(req.query['year']), Number(req.query['month']) - 1, 1).getTime();
            const nextMonthHead = new Date(Number(req.query['year']), Number(req.query['month']), 1).getTime();
            const data = await asyncAll(`select count(*), sum(price), category
                from Entry 
                where userId == ? 
                      and date >= ? 
                      and date < ? 
                group by category`,
                [
                    user.userId,
                    monthHead,
                    Math.min(nextMonthHead, new Date().getTime()),
                ]).then(data => {
                    const count = data.map(e => e['count(*)']).reduce((a, b) => a + b, 0);
                    const sum = data.map(e => e['sum(price)']).reduce((a, b) => a + b, 0);
                    const categories = {};
                    data.forEach(e => categories[e.category] = {
                        sum: e['sum(price)'],
                    });
                    return {
                        sum, count,
                        avg: sum / Math.floor((Math.min(nextMonthHead, new Date().getTime()) - monthHead) / (1000 * 60 * 60 * 24.0)),
                        categories
                    }
                }).catch(err => {
                    console.log(err);
                    return null;
                });
            if (data) {
                res.status(200);
                res.end(JSON.stringify(data));
            }
        }
    }
    res.status(400);
    res.end();
});

app.use('/', express.static('../kakeibo-front/dist/kakeibo'));