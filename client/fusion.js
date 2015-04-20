
function valueIn(field, value) {
    return function(mp) {
        var t =  mp[field];
        if (t)
            return t.indexOf(value) >= 0 ? value : "";
        return "";
    }
}
var PivotTableInit = {
    cols: ["treatment_prior_to_biopsy"], rows: ["biopsy_site"],

    rendererName: "Bar Chart",
};
id_text = function(array) {
    return array.map(function(e) { return { id: e, text: e} });
}


/* 
   Data Processing Pipeline using Session Variables 

    Phase 1
    studies - studies list from <input id="studies">
    genelist - gene list from <input id="genelist">
    samplelist - samplelist list from <input id="samplelist">
    additionalQueries - additional queries list from <input id="samplelist">

    Phase 2:
    aggregatedResults - results of find from aggreagatedQueries
    expressionResults - results of find from expression collection using genelist
    expressionIsoFormResults - results of find from expression_isofrom using using genelist

    Phase 3:
    ChartData - Join of aggregatedResults, expressionResults, expressionIsoFormResults 

    Phase 4: drawing the chart
    RedrawChart()

*/

Meteor.startup(function() {
    Meteor.subscribe("GeneSets");

    var derivers = $.pivotUtilities.derivers;
    var renderers = $.extend($.pivotUtilities.renderers, $.pivotUtilities.gchart_renderers);

    window.PivotCommonParams = {
        renderers: renderers,
        derivedAttributes: { "Age Bin": derivers.bin("age", 10), },
        hiddenAttributes: [ "_id", "Patient_ID", "Sample_ID"] 
    };


    /*
    if (Charts.find({ userId: Meteor.userId() }).count() == 0 ) {
        var chart = { pivotTableConfig: PivotTableInit }; 
        Charts.insert(chart);
    };

    Tracker.autorun(function() {
        Session.set("ChartData", Clinical_Info.find().fetch().map(Transform_Clinical_Info));
    });
    */

});

// The "this" object has to be the default dictonary of all possible keys.
function Transform_Clinical_Info(f) {
    delete f["_id"];
    // delete f["Sample_ID"];
    // delete f["Patient_ID"];
    delete f["On_Study_Date"];
    delete f["Off_Study_Date"];

    var on = f["On_Study_Date"];
    var off = f["OffStudy_Date"];
    if (off == null)
        off = Date.now();

    if (off && on)
        f["Days_on_Study"] = (off - on) / 86400000;

    delete f["On_Study_Date"];
    delete f["Off_Study_Date"];


    // Make sure that 
    Object.keys(this).map(function(k) {
        if  (f[k] == null) {
            f[k] = this[k];
        }
    });


    /*
    if  (f["Abiraterone"] == null)
        f["Abiraterone"] = "unknown";

    if  (f["Enzalutamide"] == null)
        f["Enzalutamide"] = "unknown";

    if  (f["biopsy_site"] == null)
        f["biopsy_site"] = "unknown";

    if  (f["site"] == null)
        f["site"] = "unknown";

    if  (f["Days_on_Study"] == null)
        f["Days_on_Study"] = "unknown";


    if  (f["biopsy_site"] == null)
        f["biopsy_site"] = "unknown";

    if  (f["age"] == null)
        f["age"] = "unknown";

    if (f["Reason_for_Stopping_Treatment"] == null)
        f["Reason_for_Stopping_Treatment"] = "unknown";
    */

    delete f["Death on study"];


    var r = f.Reason_for_Stopping_Treatment;
    if (r == null) r =  "n/a";
    else if (r.indexOf("unknown") >= 0) r =  "n/a";
    else if (r.indexOf("Adverse") >= 0) r =  "AE";
    else if (r.indexOf("Complet") >= 0) r =  "Complete";
    else if (r.indexOf("complet") >= 0) r =  "Complete";
    else if (r.indexOf("Death") >= 0) r =  "Death";
    else if (r.indexOf("Progress") >= 0) r =  "Progression";
    else if (r.indexOf("progress") >= 0) r =  "Progression";
    else if (r.indexOf("withdraw") >= 0) r =  "Withdraw";
    else if (r.indexOf("Discretion") >= 0) r =  "Discretion";
    f.Reason_for_Stopping_Treatment = r;
    
    var t = f["treatment_for_mcrpc_prior_to_biopsy"];
    if (t) {
        var abi = t.indexOf("Abiraterone") >= 0 ;
        var enz = t.indexOf("Enzalutamide") >= 0 ;
        if (abi && !enz) t = "Abi";
        else if (!abi && enz) t = "Enz";
        else if (abi && enz) t = "Abi-Enz";
        else if (!abi && !enz) t = "Chemo";
        else t =  "unknown";
    } else 
        t =  "unknown";

    f["treatment_prior_to_biopsy"] = t;
    delete f["treatment_for_mcrpc_prior_to_biopsy"];

    Object.keys(f).map(function(k) {
        if (f[k] == null)
           f[k] = "N/A";
    });

    return f;
};

Zclass = function(x) {
    if (x >= 2)
        return "2z";
    if (x >= 1)
        return "1z";
    if (x  < 1 && x > -1) return "near mean";
    if (x  < -1 && x > -2) return "-1z";
    if (x  < -2)  return "-2z";
}



Template.Controls.helpers({
   genesets : function() {
      return GeneSets.find({}, {sort: {"name":1}});
   },
   studies : function() {
      return Studies.find({}, {sort: {"name":1}});
   },
   additionalQueries : function() {
       var html = '';
       CRFmetadataCollection.find({}).forEach(function(vv) {
           var collName = vv.name;
           html += '<optGroup label="'+ collName +'">';

           var ft = vv.fieldTypes;
           var hasSample_ID = false;
           vv.fieldOrder.map(function(fieldName, i) {
               if (fieldName == "Sample_ID")
                   hasSample_ID = true;
           });
           vv.fieldOrder.map(function(fieldName, i) {

               var meta = { c: collName, f: fieldName, 
                   j: hasSample_ID ? "Sample_ID" : "Patient_ID" 
               };
               var value = escape(JSON.stringify(meta));
                 

               html += '    <option value="'+ value + '">'+collName + ":" +fieldName+'</option>';
           });

           html += '</optGroup>\n';
       });
       return html;
   }
})



// This will be run inside of a Tracker autorun
function aggregatedResults() {
    var additionalQueries = Session.get("additionalQueries");

    if (additionalQueries && additionalQueries.length > 0) {
        // aggregate fields 
        var aggregatedQueries = {};
        var aggregatedJoinOn = {}
        additionalQueries.map(function(query) {
            var query = JSON.parse(unescape(query));

            var collName = query.c;
            var fieldName = query.f;
            aggregatedJoinOn[collName] = query.j;

            if (collName in aggregatedQueries)
                aggregatedQueries[collName] = _.union(aggregatedQueries[collName], fieldName);
            else
                aggregatedQueries[collName] = [fieldName];

            if (collName in window) 
                CRFmetadataCollectionMap[collName] = window[collName];
            else if (!(collName in CRFmetadataCollectionMap || collName in window)) 
                CRFmetadataCollectionMap[collName] = new Meteor.Collection(collName);
        }) // additional queries

        subscribe_aggregatedQueries_1(aggregatedQueries, aggregatedJoinOn);
            
    } //  if (additionalQueries && additionalQueries.length > 0)
} // function aggregatedResults()

function subscribe_aggregatedQueries_2(aggregatedQueries, aggregatedJoinOn) {
    Meteor.subscribe("aggregatedQueries", aggregatedQueries);

    var chartData_map_Sample_ID = {};
    var chartData_map_Patient_ID = {};
    var timeout = null;

    Object.keys(aggregatedQueries).map(function(collName) {
        Tracker.autorun(function() {
            var cursor = CRFmetadataCollectionMap[collName].find();
            cursor.observe( {
                added: function(data) {
                    var fieldNames = aggregatedQueries[collName];
                    fieldNames.map(function(fieldName) {
                        if (fieldName in data) {
                            var datum = data[fieldName];
                            var displayFieldName = collName + ":" + fieldName;

                            if (!(data.Patient_ID in chartData_map_Patient_ID))
                                chartData_map_Patient_ID[data.Patient_ID] = {};
                            chartData_map_Patient_ID[data.Patient_ID][collName + ":" + fieldName] = datum;

                            if (!(data.Sample_ID in chartData_map_Sample_ID))
                                chartData_map_Sample_ID[data.Sample_ID] = {};
                            chartData_map_Sample_ID[data.Sample_ID][collName + ":" + fieldName] = datum;
                        }
                    }); // fieldNames map

                    if (timeout) window.clearTimeout(timeout);
                    timeout = setTimeout(function(){
                            Session.set("aggregatedResults", {
                                    aggregatedJoinOn: aggregatedJoinOn,
                                    chartData_map_Sample_ID: chartData_map_Sample_ID,
                                    chartData_map_Patient_ID: chartData_map_Patient_ID,
                                } );
                        }, 200); // timeout
                } // added
            }); // observe
         }); //tracker autorun
    }); // aggregatedQueries keys

}

function subscribe_aggregatedQueries_1(aggregatedQueries, aggregatedJoinOn) {
    Meteor.subscribe("aggregatedQueries", aggregatedQueries, function onReady() {
        var chartData_map_Sample_ID = {};
        var chartData_map_Patient_ID = {};
        var timeout = null;
        Object.keys(aggregatedQueries).map(function(collName) {
                var  cursor = CRFmetadataCollectionMap[collName].find();
                console.log("agg", collName, cursor.count());
                cursor.forEach( function(data) {
                    var fieldNames = aggregatedQueries[collName];
                    fieldNames.map(function(fieldName) {
                        if (fieldName in data) {
                            var datum = data[fieldName];
                            var displayFieldName = collName + ":" + fieldName;

                            if (!(data.Patient_ID in chartData_map_Patient_ID))
                                chartData_map_Patient_ID[data.Patient_ID] = {};
                            chartData_map_Patient_ID[data.Patient_ID][collName + ":" + fieldName] = datum;

                            if (!(data.Sample_ID in chartData_map_Sample_ID))
                                chartData_map_Sample_ID[data.Sample_ID] = {};
                            chartData_map_Sample_ID[data.Sample_ID][collName + ":" + fieldName] = datum;
                        }
                    }); // fieldNames map
                    }); //forEach
            }); // aggregatedQueries keys map
            Session.set("aggregatedResults", {
                aggregatedJoinOn: aggregatedJoinOn,
                chartData_map_Sample_ID: chartData_map_Sample_ID,
                chartData_map_Patient_ID: chartData_map_Patient_ID,
            });
        }) // Meteor.subscribe
    }

// The result is run inside of a tracker autorun
function geneLikeResults(sessionVar, collName, subscriptionName) {
    return function() {
        var studies = Session.get("studies");
        var genelist = Session.get("genelist");
        var samplelist = Session.get("samplelist");

        if (studies && studies.length > 0 && genelist && genelist.length > 0) {

            Meteor.subscribe(subscriptionName, studies, genelist, 
                function onReady() {
                        var docs = window[collName].find({gene: { $in: genelist}}).fetch();
                        Session.set(sessionVar, docs);
                    } // onReady()
                );

        }  // if studies
    } // return function
} // function geneLikeResults()



Template.Controls.events({
   'change #studies' : function(evt, tmpl) {
       var s = $("#studies").select2("val");
       Session.set("studies", s);
   },
   'change #additionalQueries' : function(evt, tmpl) {
       var additionalQueries = $("#additionalQueries").select2("val");
       Session.set("additionalQueries", additionalQueries); // Pipeline Phase 1
   },
   'change #samplelist' : function(evt, tmpl) {
       var s = $("#samplelist").val();
       s = s.split(/[ ,;]/).filter(function(e) { return e.length > 0 });
       Session.set("samplelist", s); // Pipeline Phase 1
   },

   'change #genelist' : function(evt, tmpl) {
       var $genelist = $("#genelist");
       var before = $genelist.select2("val");
       Session.set("genelist", before); // Pipeline Phase 1
   },

   // genesets are just a quick way to add genes to the genelist, simlar to above event
   'change #genesets' : function(evt, tmpl) {
       var val = $(evt.target).val();
       var gs = GeneSets.findOne({name: val});
       if (gs) {
           var $genelist = $("#genelist");
           var before = $genelist.select2("val");
           var after = before.concat(gs.members);
           Session.set("genelist", after); // Pipeline Phase 1
           $genelist.select2("data", after.map(function(e) { return { id: e, text: e} }));
       }
   },

   'click #clear' : function(evt, tmpl) {
       var $genelist = $("#genelist");
       $genelist.select2("data", [] );
       Session.set("genelist", []);
   }
})

function initializeSpecialJQueryUITypes() {

     $("#additionalQueries").select2( {
       placeholder: "Select one or more fields",
       allowClear: true
     } );

     $("#studies").select2( {
       placeholder: "Select one or more studies",
       allowClear: true
     } );
}



function restoreChartDocument(prev) {

     var $samplelist = $("#samplelist");
     $samplelist.val(prev.samplelist.join(" "));
     Session.set("samplelist", prev.samplelist);

     var $studies = $("#studies");
     if (prev.studies) {
         $studies.select2("data",  id_text(prev.studies));
         Session.set("studies", prev.studies);
     }

     var $additionalQueries = $("#additionalQueries");
     if (prev.additionalQueries) {
         $additionalQueries.select2("data",  prev.additionalQueries.map(function(q) {
             var qq = JSON.parse(unescape(q));
             return { id: q, text: qq.c + ":" + qq.f }
         }));
         Session.set("additionalQueries", prev.additionalQueries); // Pipeline Phase 1
     }

     var $genelist = $("#genelist");
     $genelist.select2({
          initSelection : function (element, callback) {
            if (prev && prev.genelist)
                callback( prev.genelist.map(function(g) { return { id: g, text: g }}) );
          },
          multiple: true,
          ajax: {
            url: "/fusion/genes",
            dataType: 'json',
            delay: 250,
            data: function (term) {
              var qp = {
                q: term
              };
              return qp;
            },
            results: function (data, page, query) { return { results: data.items }; },
            cache: true
          },
          escapeMarkup: function (markup) { return markup; }, // let our custom formatter work
          minimumInputLength: 2,
     });

     if (prev && prev.genelist) {
         $genelist.select2("val", prev.genelist );
     }
     Session.set("genelist", prev.genelist);

};

Template.Controls.rendered = function() {
     var thisTemplate = this;

     var ChartDocument = Charts.findOne({ userId : Meteor.userId() }); // Charts find cannot be inside of a Tracker, else we get a circularity when we update it.
     Session.set("ChartDocument", ChartDocument);

     // Phase 1
     initializeSpecialJQueryUITypes();
     restoreChartDocument(ChartDocument);

     // Phase 2
     Tracker.autorun( aggregatedResults );
     Tracker.autorun( geneLikeResults("Expression", "Expression", "GeneExpression"));
     Tracker.autorun( geneLikeResults("ExpressionIsoform", "ExpressionIsoform", "GeneExpressionIsoform"));

     // Phase 3 Get all the changed values, save the ChartDocument and join the results
     Tracker.autorun(function updateChartDocument() {

            // Any (all) of the following change, save them and update ChartData
            ChartDocument.genelist = Session.get("genelist");
            ChartDocument.studies = Session.get("studies");
            ChartDocument.samplelist = Session.get("samplelist");
            ChartDocument.additionalQueries = Session.get("additionalQueries");
            ChartDocument.aggregatedResults = Session.get("aggregatedResults");

            var cd = _.clone(ChartDocument);
            delete cd["_id"];
            Charts.update({ _id : ChartDocument._id }, {$set: cd});

            debugger;
            var q = ChartDocument.samplelist == null || ChartDocument.samplelist.length == 0 ? {} : {Sample_ID: {$in: ChartDocument.samplelist}};
            var chartData = Clinical_Info.find(q).fetch();

            var chartDataMap = {};
            chartData.map(function (cd) { chartDataMap[cd.Sample_ID] = cd; });

            ChartDocument.samplelist = chartData.map(function(ci) { return ci.Sample_ID })
                
            var domains = [ "Expression", "ExpressionIsoform"];
            domains.map(function (geneLikeDataDomain) {
                var gld = Session.get(geneLikeDataDomain);
                if (gld) {
                    gld.map(function(geneData) {
                        var geneName = geneData.gene;
                        var label = ('transcript' in geneData) 
                            ? geneName + ' ' + geneData.transcript + ' Expr'
                            : geneName + ' Expr';
                        var samplelist =  _.intersection( ChartDocument.samplelist, Object.keys(geneData.samples) );
                        samplelist.map(function (sampleID) {
                            var f = parseFloat(geneData.samples[sampleID].rsem_quan_log2);
                            if (!isNaN(f)) {
                                chartDataMap[sampleID][label] = f;
                            }
                        });
                    });
                }
            });

            function Join(datum, joinKey, dataMap) {
                if (joinKey in datum && datum[joinKey] in dataMap)
                    $.extend(datum, dataMap[ datum[joinKey] ]);
            }

            var keyUnion = {};  
            chartData.map(function(datum) { 
                if (ChartDocument.aggregatedResults) {
                    Join(datum, "Sample_ID", ChartDocument.aggregatedResults.chartData_map_Sample_ID);
                    Join(datum, "Patient_ID", ChartDocument.aggregatedResults.chartData_map_Patient_ID);
                }
                $.extend(keyUnion, datum);
            });

            Object.keys(keyUnion).map(function(k) { keyUnion[k] = "unknown"; });
            chartData = chartData.map(Transform_Clinical_Info, keyUnion);
            Session.set("ChartData", chartData);

    });


     // Phase 4 repaint
     Tracker.autorun( function RedrawChart() {
        var chartData = Session.get("ChartData");
        templateContext = { 
            onRefresh: function(config) {
                var save = { cols: config.cols, rows: config.rows,
                    aggregatorName: config.aggregatorName,
                    rendererName: config.rendererName,
                };
                ChartDocument.pivotTableConfig =  save;
            }
        }
        var config = ChartDocument ? ChartDocument.pivotTableConfig : PivotTableInit;
        var final =  $.extend({}, PivotCommonParams, templateContext, config);
        $(".output").pivotUI(chartData, final);
    }); // autoRun
} // 
