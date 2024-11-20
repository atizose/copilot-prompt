const axios = require('axios');
const fs = require('fs');

// Azure OpenAI API配置
const apiUrl = 'url'
const apiKey = 'yourkey';

// 调用Azure OpenAI服务并将结果写入文件
async function callAzureOpenAI(filledTemplate) {
    let finalOutput = '';

    try {
        let response = await axios.post(apiUrl, {
            messages: [{ role: 'system', content: filledTemplate }],
            max_tokens: 1000
        }, {
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey
            }
        });

        console.log('Azure OpenAI API response:', response.data.usage);
        finalOutput += response.data.choices[0].message.content + '\n##########\n';
    } catch (error) {
        console.error('Error calling Azure OpenAI API:', error);
        console.error('Error details:', error.response ? error.response.data : error.message);
    }

    return finalOutput;
}


module.exports = { callAzureOpenAI };
