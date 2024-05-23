const $X = (
    xpath,
    contextNode = document,
    resultType = XPathResult.ORDERED_NODE_ITERATOR_TYPE,
) => {
    const result = document.evaluate(xpath, contextNode, null, resultType, null);
    const nodes = [];
    for (let node = result.iterateNext(); node; node = result.iterateNext()) {
        nodes.push(node);
    }
    return nodes;
};

const findElementsByXpath = $X;

const scrollToBottom = (delayPerIter = 1000, maxIters = 15) => {
    let iterCnt = 0;
    return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
            if (iterCnt++ === maxIters) {
                clearInterval(interval);
                reject();
            }

            const beforeScrollTop = document.body.scrollTop || document.documentElement.scrollTop;
            window.scrollTo(0, document.documentElement.scrollHeight);

            // Check if the scroll position is at the bottom
            const afterScrollTop = document.body.scrollTop || document.documentElement.scrollTop;
            if (beforeScrollTop === afterScrollTop) {
                clearInterval(interval);
                resolve();
            }
        }, delayPerIter);
    });
};
