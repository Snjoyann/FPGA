/*
const result = {
    rowCount: 2,
    rows: [
{
    id:5,
    test_id : 3,
    regression_run_id:1,
    status:"failed"
},
{
    id:6,
    regression_run_id: 2,
    test_run_id:4,
    status:"passed" 
}
    ]
};

console.log(result.rows[1].test_id);
console.log(result.rows[1].test_run_id);
*/

/*const request ={
    body:{
        
        regression_run_id: 2,
        test_id: 3,
        status: "passed"
    }

  
    };
    const {regression_run_id, test_id, status} = request.body;

const hasValidNumbers =  Number.isInteger(regression_run_id) && Number.isInteger(test_id);
const hasValidStatus = status === "passed" || status === "failed";*/

/*
if(!hasValidNumbers || !hasValidStatus){
    console.log("400 Bad request");
}
else{
    console.log("201 Created");
}
*/
const references = {
    regressionRunExists:true,
    testExists: false
}
if(!references.regressionRunExists || !references.testExists){
    console.log("404 not found");
}
else{
    console.log("Referenced rows Existed");
}
