
export function update_dict(target, dict) {
    for (const key in dict) {
        if (dict.hasOwnProperty(key)) {
            if (key in target) {
                if (dict[key] instanceof Object) {
                    update_dict(target[key], dict[key]);
                } else {
                    target[key] = dict[key];
                }
            }
        }
    }
}
