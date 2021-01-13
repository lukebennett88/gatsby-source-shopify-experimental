require("dotenv").config()
const fetch = require("node-fetch")
const { createNodeHelpers } = require("gatsby-node-helpers")
const { createInterface } = require("readline")
const GraphQLClient = require("graphql-request").GraphQLClient

const adminUrl = `https://${process.env.SHOPIFY_ADMIN_API_KEY}:${process.env.SHOPIFY_ADMIN_PASSWORD}@${process.env.SHOPIFY_STORE_URL}/admin/api/2021-01/graphql.json`
const client = new GraphQLClient(adminUrl)

const Node = remoteType => createNodeFactory(remoteType)

module.exports.sourceNodes = async function({ reporter, actions, createNodeId, createContentDigest }) {
  const nodeHelpers = createNodeHelpers({
    typePrefix: `Shopify`,
    createNodeId,
    createContentDigest,
  })

  const productsOperation = `
    mutation {
      bulkOperationRunQuery(
      query: """
        {
          products {
            edges {
              node {
                id
                title
                variants {
                  edges {
                    node {
                      id
                      availableForSale
                      compareAtPrice
                      price
                      metafields {
                        edges {
                          node {
                            id
                            description
                            value
                            valueType
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        """
      ) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `

  const operationStatusQuery = `
    query {
      currentBulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  `

  const response = await client.request(productsOperation)

  if (response.bulkOperationRunQuery.userErrors.length) {
    reporter.panic({
      context: {
        sourceMessage: `Couldn't perform bulk operation`
      }
    }, ...response.bulkOperationRunQuery.userErrors)
  }

  let operationResponse

  while(true) {
    console.info(`Polling bulk operation status`)
    operationResponse = await client.request(operationStatusQuery)
    console.info(operationResponse)
    if (operationResponse.currentBulkOperation.status === `COMPLETED`) {
      break
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  const results = await fetch(operationResponse.currentBulkOperation.url)
  const rl = createInterface({
    input: results.body,
    crlfDelay: Infinity,
  })

  const objects = []
  for await (const line of rl) {
    objects.push(JSON.parse(line))
  }

  // 'gid://shopify/Metafield/6936247730264'
  const pattern = /^gid:\/\/shopify\/(\w+)\/(.+)$/
  const factoryMap = {}
  for(var i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i]
    console.log(obj)
    const [_, remoteType] = obj.id.match(pattern)
    if (!factoryMap[remoteType]) {
      factoryMap[remoteType] = nodeHelpers.createNodeFactory(remoteType)
    }

    const Node = factoryMap[remoteType]
    const node = Node(obj)
    actions.createNode(node)
  }
}
