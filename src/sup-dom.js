const findElementsByXpath = (xpath) => {
    const result = document.evaluate(xpath, document, null, XPathResult.ANY_TYPE, null);
    let nodes = [];
    for (let node = result.iterateNext(); node; node = result.iterateNext()) {
        nodes.push(node);
    }
    return nodes;
};
