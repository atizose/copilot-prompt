const fs = require('fs');
const xlsx = require('xlsx');

const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const { callAzureOpenAI } = require('./azure_api');

// 读取 JavaScript 文件的内容
const jsCode = fs.readFileSync('extension.js', 'utf-8');

const templatePath = path.join(__dirname, 'prompt.template');
const prompt_info = fs.readFileSync(templatePath, 'utf-8');

// 将 JavaScript 代码解析为 AST
const ast = parser.parse(jsCode, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties']
});

console.log("开始分析 ..");

// 辅助函数，递归查找父类，判断是否包含 'PromptElement'
function containsPromptElement(superClass) {
    if (!superClass) return false;

    let superClassName = '';
    if (superClass.type === 'Identifier') {
        superClassName = superClass.name;
    } else if (superClass.type === 'MemberExpression') {
        superClassName = `${superClass.object.name}.${superClass.property.name}`;
    } else if (superClass.type === 'CallExpression') {
        // 特殊处理调用表达式（如工厂函数）
        return containsPromptElement(superClass.callee);
    }

    if (superClassName.includes('PromptElement')) {
        return true;
    }

    // 如果初始化值存在并且是Identifier或MemberExpression类型，继续查找
    const init = variableDefinitions[superClassName];
    if (init) {
        return containsPromptElement(init.node.init || init.node.right);
    }

    return false;
}

let classDetails = [];
// 收集变量定义
const variableDefinitions = {};

// 遍历 AST，记录变量定义并提取类的详细信息
traverse(ast, {
    VariableDeclarator(path) {
        const variableName = path.node.id.name;
        // 存储变量初始值和路径
        variableDefinitions[variableName] = path;

        // 检查变量声明的初始化部分是否为 ClassExpression
        if (path.node.init && path.node.init.type === 'ClassExpression') {
            let varName = path.node.id.name;
            let className = path.node.init.id ? path.node.init.id.name : '<匿名>';
            let superClass = path.node.init.superClass;

            if (containsPromptElement(superClass)) {
                let superClassString = superClass ? (superClass.type === 'MemberExpression'
                    ? `${superClass.object.name}.${superClass.property.name}`
                    : superClass.name) : null;

                let code = generate(path.node).code;
                // 增加用于存储已使用的方法和变量名称的数组
                const classDetail = { varName, className, superClass: superClassString, usedMethodName: [], usedVarname: [], usedproperty: [], code };
                classDetails.push(classDetail);

                // 遍历类中的代码块，收集使用到的方法、变量以及属性
                collectUsedIdentifiers(path, classDetail);
            }
        }
    },
    AssignmentExpression(path) {
        if (path.node.left.type === 'MemberExpression') {
            const objectName = path.node.left.object.name;
            const propertyName = path.node.left.property.name;

            if (!variableDefinitions[objectName]) {
                variableDefinitions[objectName] = {};
            }

            variableDefinitions[objectName][propertyName] = path;
        }
    },
    ClassDeclaration(path) {
        // 提取类名和继承的父类信息
        let varName = path.node.id.name;
        let className = path.node.id.name;
        let superClass = path.node.superClass;

        if (containsPromptElement(superClass)) {
            let superClassString = superClass ? (superClass.type === 'MemberExpression'
                ? `${superClass.object.name}.${superClass.property.name}`
                : superClass.name) : null;

            let code = generate(path.node).code;
            // 增加用于存储已使用的方法和变量名称的数组
            const classDetail = { varName, className, superClass: superClassString, usedMethodName: [], usedVarname: [], usedproperty: [], code };
            classDetails.push(classDetail);

            // 遍历类中的代码块，收集使用到的方法、变量以及属性
            collectUsedIdentifiers(path, classDetail);
        }
    }
});


// 收集在给定节点中被使用到的标识符
function collectUsedIdentifiers(path, classDetail) {
    traverse(path.node, {
        MemberExpression(memberPath) {
            const objectNode = memberPath.node.object;
            const propertyNode = memberPath.node.property;

            if (objectNode.type === 'ThisExpression') {
                const usedMethodName = propertyNode.name;
                if (!classDetail.usedMethodName.includes(usedMethodName)) {
                    classDetail.usedMethodName.push(usedMethodName);
                }
            } else if (objectNode.type === 'Identifier') {
                const usedVarName = objectNode.name;
                if (!classDetail.usedVarname.includes(usedVarName)) {
                    classDetail.usedVarname.push(usedVarName);
                }

                const usedProperty = propertyNode.name;
                if (!classDetail.usedproperty.includes(usedProperty)) {
                    classDetail.usedproperty.push(usedProperty);
                }
            }
        },
        CallExpression(callPath) {
            const calleeNode = callPath.node.callee;

            if (calleeNode.type === 'MemberExpression') {
                const objectNode = calleeNode.object;
                const propertyNode = calleeNode.property;

                if (objectNode.type === 'ThisExpression') {
                    const usedMethodName = propertyNode.name;
                    if (!classDetail.usedMethodName.includes(usedMethodName)) {
                        classDetail.usedMethodName.push(usedMethodName);
                    }
                } else if (objectNode.type === 'Identifier') {
                    const usedVarName = objectNode.name;
                    if (!classDetail.usedVarname.includes(usedVarName)) {
                        classDetail.usedVarname.push(usedVarName);
                    }

                    const usedProperty = propertyNode.name;
                    if (!classDetail.usedproperty.includes(usedProperty)) {
                        classDetail.usedproperty.push(usedProperty);
                    }
                }
            } else if (calleeNode.type === 'Identifier') {
                const usedVarName = calleeNode.name;
                if (!classDetail.usedVarname.includes(usedVarName)) {
                    classDetail.usedVarname.push(usedVarName);
                }
            }
        },
        Identifier(identifierPath) {
            if (identifierPath.parent.type !== 'MemberExpression' && 
                identifierPath.node.name !== classDetail.varName && 
                identifierPath.node.name !== classDetail.className) {
                const usedVarName = identifierPath.node.name;
                if (!classDetail.usedVarname.includes(usedVarName)) {
                    classDetail.usedVarname.push(usedVarName);
                }
            }
        }
    }, path.scope, path);
}


// // 打印 classDetails，但不输出整个对象
// if (classDetails.length === 0) {
//     console.log("classDetails 为空。没有找到包含 PromptElement 的类。");
// } else {
//     // 只输出 varName 和 className 以便调试，避免解析过长的字符串
//     classDetails.forEach((detail, index) => {
//         console.log(`classDetail ${index + 1}: varName=${detail.varName}, className=${detail.className}`);
//         console.log(`code: ${detail.code}`);
//         console.log(`usedMethodName: ${detail.usedMethodName.join(', ')}`);
//         console.log(`usedVarname: ${detail.usedVarname.join(', ')}`);
//         console.log(`usedproperty: ${detail.usedproperty.join(', ')}`);
//     });
// }
// // 打印部分 variableDefinitions 以便调试，避免解析过长的字符串
// Object.keys(variableDefinitions).slice(0, 10).forEach(key => {
//     console.log(`variableDefinition: ${key}, type: ${variableDefinitions[key].type}`);
// });




// Resolve function call chain
function resolveFunctionCall(node, chain = [], visited = new Set()) {
    if (!node || node.type !== 'CallExpression') {
        return null;
    }

    const calleeName = node.callee.name || (node.callee.object && node.callee.object.name);
    if (!calleeName || visited.has(calleeName) || !variableDefinitions[calleeName]) {
        return null;
    }

    visited.add(calleeName);

    const path = variableDefinitions[calleeName];
    const init = path.node.init || path.node.right;
    chain.push({ name: calleeName, code: generate(path.node).code });

    if (init.type === 'CallExpression') {
        resolveFunctionCall(init, chain, visited);
    }

    for (const arg of node.arguments) {
        if (arg.type === 'Identifier') {
            getVariableChain(arg.name, chain, visited);
        } else if (arg.type === 'CallExpression') {
            resolveFunctionCall(arg, chain, visited);
        }
    }

    return chain;
}



// 递归获取变量链
function getVariableChain(variableName, chain = [], visited = new Set()) {
    if (visited.has(variableName)) {
        return null;
    }
    visited.add(variableName);

    const path = variableDefinitions[variableName];
    if (!path) return null;

    const node = path.node;
    if (!node) return null;  // 确保节点存在

    const code = generateSafely(node);
    chain.push({ name: variableName, code: code });

    const init = node.init || node.right;
    if (!init) return chain;  // 确保 init 存在

    if (init.type === 'CallExpression') {
        resolveFunctionCall(init, chain, visited);
    } else if (init.type === 'Identifier') {
        getVariableChain(init.name, chain, visited);
    } else if (init.type === 'MemberExpression') {
        const objectName = init.object.name;
        const propertyName = init.property.name;
        getVariableChain(objectName, chain, visited);

        const memberPath = variableDefinitions[objectName] && variableDefinitions[objectName][propertyName];
        if (memberPath && memberPath.node) {  // 确保 node 存在
            const memberCode = generateSafely(memberPath.node);
            chain.push({ name: `${objectName}.${propertyName}`, code: memberCode });
        }
    }

    return chain;
}

// Using a safe version of generate to handle any undefined cases
function generateSafely(node) {
    try {
        return generate(node).code;
    } catch (error) {
        console.error(`Error generating code for node`, error);
        return '';
    }
}

// 获取类的父类链
function getClassSuperChain(className) {
    const visited = new Set();
    const chain = [];
    const path = variableDefinitions[className];
    if (!path) return null;

    const code = generateSafely(path.node);
    chain.push({ name: className, code: code });
    visited.add(className);

    const init = path.node.init;
    if (init && init.superClass) {
        if (init.superClass.type === 'MemberExpression') {
            const superClassName = `${init.superClass.object.name}.${init.superClass.property.name}`;
            chain.push({ name: superClassName, code: generateSafely(init.superClass) });
            const superChain = getVariableChain(init.superClass.object.name, [], visited);
            if (superChain) {
                chain.push(...superChain);
            }
        } else if (init.superClass.type === 'Identifier') {
            const superClassName = init.superClass.name;
            chain.push({ name: superClassName, code: generateSafely(init.superClass) });
            const superChain = getVariableChain(superClassName, [], visited);
            if (superChain) {
                chain.push(...superChain);
            }
        }
    }

    return chain;
}


// 遍历 classDetails，查找每个变量调用链的详细信息并获取代码内容
const final_output = [];
for (const classDetail of classDetails) {
    const { varName, className, superClass, usedMethodName, usedVarname, usedproperty } = classDetail;
    console.log('classDetail:', varName, className, superClass);

    const qiSuperChain = getClassSuperChain(varName);

    const result = [];
    if (qiSuperChain && qiSuperChain.length > 0) {
        result.push(`当前类方法`);
        const uniqueChain = Array.from(new Set(qiSuperChain.map(item => JSON.stringify(item))))
            .map(item => JSON.parse(item));
        
        // 输出当前类的第一个链
        result.push(`${uniqueChain[0].code}`);
        result.push(`关联的父类链`);
        // 从第二个链开始输出
        for (let i = 1; i < uniqueChain.length; i++) {
            const item = uniqueChain[i];
            result.push(`Variable/Function: \n${item.code}`);
        }
    }
    
    const allUsedNames = new Set([...usedMethodName, ...usedVarname, ...usedproperty]);
    result.push(`关联的变量`);
    for (const usedName of allUsedNames) {
        const varChain = getVariableChain(usedName);
        if (varChain && varChain.length > 0) {
            // result.push(`Call chain for ${usedName}:`);
            const uniqueChain = Array.from(new Set(varChain.map(item => JSON.stringify(item))))
                .map(item => JSON.parse(item));
            uniqueChain.forEach((item, index) => {
                result.push(`Variable/Function:\n${item.code}`);
            });
        } else {
            // result.push(`No call chain found for ${usedName}.`);
        }
    }
    
    const finalResult = result.join('\n');
    fs.writeFileSync('temp.txt', finalResult, 'utf8');
    final_output.push(finalResult);
    console.log(`Chain for ${varName} and used identifiers has been written to temp.txt.`);
}

if (final_output.length > 0) {
    fs.writeFileSync('final_class_chain-11160000.txt', final_output.join('\n++++++++++++++++++++++\n'), 'utf8');
    console.log('Final class chain has been written to final_class_chain.txt.');
} else {
    console.log('No class chains found.');
}



async function processClassDetails() {
    let idx = 0;
    const excelFilePath = 'parse_output_prompt111.xlsx';
    const jsonlFilePath = 'parse_output_prompt111.jsonl';
    let excelData;

    // 检查 Excel 文件是否存在，如果存在则读取，否则初始化新的数据结构
    let workbook;
    if (fs.existsSync(excelFilePath)) {
        workbook = xlsx.readFile(excelFilePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        if (worksheet) {
            excelData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        } else {
            // 如果没有找到工作表，则初始化 excelData
            excelData = [['Index', 'Template', 'Result']];
        }
    } else {
        // 初始化一个新的工作簿和数据结构
        workbook = xlsx.utils.book_new();
        excelData = [['Index', 'Template', 'Result']]; // 添加表头
        const worksheet = xlsx.utils.aoa_to_sheet(excelData);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');
    }

    for (let sub_str of final_output) {
        idx++;
        console.log(`Processed class ${idx}/${final_output.length}`);

        const classChatTemplate = prompt_info;
        const filledTemplate = classChatTemplate.replace('{class类集合}', sub_str);

        const result = await callAzureOpenAI(filledTemplate);

        fs.appendFileSync('output_with_prompt-1118.txt', 
            '\n#####Start#####\n' +
            filledTemplate + 
            '\n*******返回结果 prompt*******\n' +
            result + 
            '\n#####END#####\n', 'utf-8');

        fs.appendFileSync('output_no_prompt-1118.txt', 
            `idx: ${idx}\n` + 
            '*******返回结果*******\n' +
            result + 
            '\n**********************\n', 'utf-8');

        // 将结果添加到 excelData 数组中
        excelData.push([idx, filledTemplate, result]);

        // 将结果按条写入 jsonl 文件
        const jsonlEntry = {
            idx: idx,
            template: filledTemplate,
            result: result
        };
        fs.appendFileSync(jsonlFilePath, JSON.stringify(jsonlEntry) + '\n', 'utf-8');

        try {
            // 将修改后的数据重新写入同一个工作表
            const worksheet = xlsx.utils.aoa_to_sheet(excelData);
            workbook.Sheets['Results'] = worksheet;

            // 重新写入文件
            xlsx.writeFile(workbook, excelFilePath);
        } catch (error) {
            console.error(`Error writing to Excel file: ${error}`);
            continue; // Skip to the next iteration
        }

        // if (idx > 5) {
        //     break;
        // }
    }
    console.log('Finished processing all classes and writing to Excel!');
}


processClassDetails();
