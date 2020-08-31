

target = {
    a: 1,
    b: {
        c: 'hoge',
    },
    d: undefined
};

update_dict(target, {
    b: 33
});

console.log(target);